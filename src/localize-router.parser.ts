import { Routes, Route } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Location } from '@angular/common';
import { CacheMechanism, LocalizeRouterSettings } from './localize-router.config';
import { Inject } from '@angular/core';

const COOKIE_EXPIRY = 30; // 1 month

/**
 * Abstract class for parsing localization
 */
export abstract class LocalizeParser {
  locales: Array<string>;
  currentLang: string;
  routes: Routes;
  defaultLang: string;
  translate: TranslateService;

  protected prefix: string;

  private _translationObject: any;
  private _wildcardRoute: Route;
  private _languageRoute: Route;

  /**
   * Loader constructor
   * @param location
   * @param settings
   */
  constructor(
    @Inject(Location) private location: Location,
    @Inject(LocalizeRouterSettings) private settings: LocalizeRouterSettings
  ) {
  }

  /**
   * Load routes and fetch necessary data
   * @param routes
   * @returns {Promise<any>}
   */
  abstract load(routes: Routes, translate: TranslateService, isInTransfer?: boolean): Promise<any>;

  /**
   * Initialize language and routes 
   * @param routes
   * @returns {Promise<any>}
   */
  protected init(routes: Routes, translate: TranslateService, isInTransfer?: boolean): Promise<any> {
    let selectedLanguage: string;
    this.routes = routes;
    this.translate = translate;

    if (!this.locales || !this.locales.length) {
      return Promise.resolve();
    }
    /** detect current language */
    let locationLang = this.getLocationLang();
    let browserLang = this._getBrowserLang();

    if (this.settings.defaultLangFunction) {
      this.defaultLang = this.settings.defaultLangFunction(this.locales, this._cachedLang, browserLang);
    } else {
      this.defaultLang = this._cachedLang || browserLang || this.locales[0];
    }
    selectedLanguage = locationLang || this.defaultLang;
    this.translate.setDefaultLang(this.defaultLang);

    if (isInTransfer) {
      this._languageRoute = this.routes.find((_route) => {
        return _route.data && _route.data.type === 'lang-root';
      });
      return this.translate.use(selectedLanguage).pipe(
        map((translations: any) => {
          this._translationObject = translations;
          this.currentLang = selectedLanguage;
        })).toPromise();
    }

    let children: Routes = [];
    /** if set prefix is enforced */
    if (this.settings.alwaysSetPrefix) {
      const baseRoute = { path: '', redirectTo: this.defaultLang, pathMatch: 'full' };

      /** extract potential wildcard route */
      let wildcardIndex = routes.findIndex((route: Route) => route.path === '**');
      if (wildcardIndex !== -1) {
        this._wildcardRoute = routes.splice(wildcardIndex, 1)[0];
      }
      children = this.routes.splice(0, this.routes.length, baseRoute);
    } else {
      children = [...this.routes]; // shallow copy of routes
    }

    /** exclude certain routes */
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i].data && children[i].data['skipRouteLocalization']) {
        if (this.settings.alwaysSetPrefix) {
          // add directly to routes
          this.routes.push(children[i]);
        }
        children.splice(i, 1);
      } else {
        if (!children[i].data) {
          children[i].data = {};
        }
        if (!children[i].data['skipRouteLocalization']) {
          children[i].data.localizeRouter = { path: children[i].path, redirectTo: children[i].redirectTo };
        }
      }
    }

    /** append children routes */
    if (children && children.length) {
      if (this.locales.length > 1 || this.settings.alwaysSetPrefix) {
        this._languageRoute = {
          path: selectedLanguage,
          data: {
            type: 'lang-root'
          },
          children: children
        };
        this.routes.unshift(this._languageRoute);
      }
    }

    /** ...and potential wildcard route */
    if (this._wildcardRoute && this.settings.alwaysSetPrefix) {
      this.routes.push(this._wildcardRoute);
    }

    /** translate routes */
    const res = this.translateRoutes(selectedLanguage);
    return res.toPromise();

  }

  initChildRoutes(routes: Routes) {
    this._translateRouteTree(routes);
    return routes;
  }

  /**
   * Translate routes to selected language
   * @param language
   * @returns {Promise<any>}
   */
  translateRoutes(language: string): Observable<any> {
    this._cachedLang = language;
    if (this._languageRoute) {
      this._languageRoute.path = language;
      this._languageRoute.data = {};
      this._languageRoute.data['type'] = 'lang-root';
    }

    return this.translate.use(language).pipe(
      map((translations: any) => {
        this._translationObject = translations;
        this.currentLang = language;

        if (this._languageRoute) {
          if (this._languageRoute) {
            this._translateRouteTree(this._languageRoute.children);
          }
          // if there is wildcard route
          if (this._wildcardRoute && this._wildcardRoute.redirectTo) {
            this._translateProperty(this._wildcardRoute, 'redirectTo', true);
          }
        } else {
          this._translateRouteTree(this.routes);
        }

      }));
  }

  /**
   * Translate the route node and recursively call for all it's children
   * @param routes
   * @private
   */
  private _translateRouteTree(routes: Routes): void {
    routes.forEach((route: Route) => {
      if (route.data && route.data['skipRouteLocalization']) {
        return;
      }
      if (route.path && route.path !== '**') {
        this._translateProperty(route, 'path');
      }
      if (route.redirectTo) {
        this._translateProperty(route, 'redirectTo', !route.redirectTo.indexOf('/'));
      }
      if (route.children) {
        this._translateRouteTree(route.children);
      }
      if (route.loadChildren && (<any>route)._loadedConfig) {
        this._translateRouteTree((<any>route)._loadedConfig.routes);
      }
    });
  }

  /**
   * Translate property
   * If first time translation then add original to route data object
   * @param route
   * @param property
   * @param prefixLang
   * @private
   */
  private _translateProperty(route: Route, property: string, prefixLang?: boolean): void {
    // set property to data if not there yet
    let routeData: any = route.data = route.data || {};
    if (!routeData.localizeRouter) {
      routeData.localizeRouter = {};
    }
    if (!routeData.localizeRouter[property]) {
      routeData.localizeRouter[property] = (<any>route)[property];
    }

    let result = this.translateRoute(routeData.localizeRouter[property]);
    (<any>route)[property] = prefixLang ? `/${this.urlPrefix}${result}` : result;
  }

  get urlPrefix() {
    return this.settings.alwaysSetPrefix || this.currentLang !== this.defaultLang ? this.currentLang : '';
  }

  /**
   * Translate route and return observable
   * @param path
   * @returns {string}
   */
  translateRoute(path: string): string {
    let queryParts = path.split('?');
    if (queryParts.length > 2) {
      throw 'There should be only one query parameter block in the URL';
    }
    let pathSegments = queryParts[0].split('/');

    /** collect observables  */
    return pathSegments
      .map((part: string) => part.length ? this.translateText(part) : part)
      .join('/') +
      (queryParts.length > 1 ? `?${queryParts[1]}` : '');
  }

  /**
   * Get language from url
   * @returns {string}
   * @private
   */
  getLocationLang(url?: string): string {
    let queryParamSplit = (url || this.location.path()).split('?');
    let pathSlices: string[] = [];
    if (queryParamSplit.length > 0) {
      pathSlices = queryParamSplit[0].split('/');
    }
    if (pathSlices.length > 1 && this.locales.indexOf(pathSlices[1]) !== -1) {
      return pathSlices[1];
    }
    if (pathSlices.length && this.locales.indexOf(pathSlices[0]) !== -1) {
      return pathSlices[0];
    }
    return null;
  }

  /**
   * Get user's language set in the browser
   * @returns {string}
   * @private
   */
  private _getBrowserLang(): string {
    return this._returnIfInLocales(this.translate.getBrowserLang());
  }

  /**
   * Get language from local storage or cookie
   * @returns {string}
   * @private
   */
  private get _cachedLang(): string {
    if (!this.settings.useCachedLang) {
      return;
    }
    if (this.settings.cacheMechanism === CacheMechanism.LocalStorage) {
      return this._cacheWithLocalStorage();
    }
    if (this.settings.cacheMechanism === CacheMechanism.Cookie) {
      return this._cacheWithCookies();
    }
  }

  /**
   * Save language to local storage or cookie
   * @param value
   * @private
   */
  private set _cachedLang(value: string) {
    if (!this.settings.useCachedLang) {
      return;
    }
    if (this.settings.cacheMechanism === CacheMechanism.LocalStorage) {
      this._cacheWithLocalStorage(value);
    }
    if (this.settings.cacheMechanism === CacheMechanism.Cookie) {
      this._cacheWithCookies(value);
    }
  }

  /**
   * Cache value to local storage
   * @param value
   * @returns {string}
   * @private
   */
  private _cacheWithLocalStorage(value?: string): string {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    try {
      if (value) {
        window.localStorage.setItem(this.settings.cacheName, value);
        return;
      }
      return this._returnIfInLocales(window.localStorage.getItem(this.settings.cacheName));
    } catch (e) {
      // weird Safari issue in private mode, where LocalStorage is defined but throws error on access
      return;
    }
  }

  /**
   * Cache value via cookies
   * @param value
   * @private
   */
  private _cacheWithCookies(value?: string): string {
    if (typeof document === 'undefined' || typeof document.cookie === 'undefined') {
      return;
    }
    try {
      const name = encodeURIComponent(this.settings.cacheName);
      if (value) {
        let d: Date = new Date();
        d.setTime(d.getTime() + COOKIE_EXPIRY * 86400000); // * days
        document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()}`;
        return;
      }
      const regexp = new RegExp('(?:^' + name + '|;\\s*' + name + ')=(.*?)(?:;|$)', 'g');
      const result = regexp.exec(document.cookie);
      return decodeURIComponent(result[1]);
    } catch (e) {
      return; // should not happen but better safe than sorry
    }
  }

  /**
   * Check if value exists in locales list
   * @param value
   * @returns {any}
   * @private
   */
  private _returnIfInLocales(value: string): string {
    if (value && this.locales.indexOf(value) !== -1) {
      return value;
    }
    return null;
  }

  /**
   * Get translated value
   * @param key
   * @returns {any}
   */
  private translateText(key: string): string {
    if (!this._translationObject) {
      return key;
    }
    let res = this.translate.getParsedResult(this._translationObject, this.prefix + key);
    switch (typeof res) {
      case 'string':
        return res;
      case 'object':
        return res['PAGE_NAME'] ? res['PAGE_NAME']: key;
      default:
        return key;
    }
  }
}

/**
 * Manually set configuration
 */
export class ManualParserLoader extends LocalizeParser {

  /**
   * CTOR
   * @param translate
   * @param location
   * @param settings
   * @param locales
   * @param prefix
   */
  constructor(location: Location, settings: LocalizeRouterSettings, locales: string[] = ['en'], prefix: string = 'ROUTES.') {
    super(location, settings);
    this.locales = locales;
    this.prefix = prefix || '';
  }

  /**
   * Initialize or append routes
   * @param routes
   * @returns {Promise<any>}
   */
  load(routes: Routes, translate: TranslateService, isInTransfer?: boolean): Promise<any> {
    return new Promise((resolve: any) => {
      this.init(routes, translate, isInTransfer).then((value) => {
        resolve();
      });
    });
  }
}

export class DummyLocalizeParser extends LocalizeParser {
  load(routes: Routes, translate: TranslateService): Promise<any> {
    return new Promise((resolve: any) => {
      this.init(routes, translate, false).then(resolve);
    });
  }
}
