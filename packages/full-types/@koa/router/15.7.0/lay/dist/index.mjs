// src/utils/router-events.ts
// @ts-ignore
import compose from "koa-compose";
var RouterEvents = {
  /**
   * Fires when no route matched the request path + HTTP method.
   */
  NotFound: "not-found"
  // /**
  //  * Fires when the request path matched a registered route but the HTTP
  //  * method did not match any of its allowed methods.
  //  *
  //  * @planned Not yet active — handlers are stored but not called.
  //  */
  // MethodNotAllowed: 'method-not-allowed',
  // /**
  //  * Fires after a route is matched and before its handlers run.
  //  * Useful for tracing and logging the matched route.
  //  *
  //  * @planned Not yet active — handlers are stored but not called.
  //  */
  // Match: 'match',
  // /**
  //  * Fires on every request that enters the router, before route matching.
  //  * Useful for per-router metrics and request logging.
  //  *
  //  * @planned Not yet active — handlers are stored but not called.
  //  */
  // Dispatch: 'dispatch'
};
function resolveEvent(selector: any) {
  return typeof selector === "function" ? selector(RouterEvents) : selector;
}
var RouterEventEmitter = class {
  _handlers = /* @__PURE__ */ new Map<string, Middleware[]>();
  /**
   * Register a handler for the given event.
   * Multiple handlers for the same event are composed in registration order.
   */
  register(event: string, handler: Middleware) {
    const existing = this._handlers.get(event) ?? [];
    existing.push(handler);
    this._handlers.set(event, existing);
  }
  /**
   * Emit an event by composing and running all registered handlers.
   * If no handlers are registered for the event, calls `next()` directly.
   *
   * @param event   - The event to emit
   * @param context - The router context
   * @param next    - The downstream next function
   */
  emit(event: string, context: RouterContext, next: Next) {
    const handlers = this._handlers.get(event);
    if (handlers && handlers.length > 0) {
      return compose(handlers)(context, next);
    }
    return next();
  }
};

// src/utils/parameter-match.ts
// @ts-ignore
import createHttpError from "http-errors";
function createParameterValidationMiddleware(parameterName: string, pattern: RegExp, options: any = {}) {
  if (!(pattern instanceof RegExp)) {
    throw new TypeError("pattern must be a RegExp instance");
  }
  const matcher = new RegExp(pattern.source, pattern.flags);
  const createDefaultHttpError = (message: any) => {
    const httpError = createHttpError(options.status ?? 400, message);
    if (options.expose !== void 0) {
      httpError.expose = options.expose;
    }
    return httpError;
  };
  const validateValue = (value: any) => {
    if (matcher.global || matcher.sticky) {
      matcher.lastIndex = 0;
    }
    if (matcher.test(value)) {
      return;
    }
    if (options.createError) {
      throw options.createError(parameterName, value);
    }
    throw createDefaultHttpError(
      options.message ?? `Invalid value for parameter "${parameterName}": "${value}"`
    );
  };
  const middleware = async (argument1: any, argument2: any, argument3: any) => {
    if (typeof argument1 !== "string") {
      const context = argument1;
      const next2 = argument2;
      const parameterValue = context.params && parameterName in context.params ? context.params[parameterName] : void 0;
      if (typeof parameterValue !== "string") {
        throw createDefaultHttpError(
          options.message ?? `Missing required parameter "${parameterName}" in route params`
        );
      }
      validateValue(parameterValue);
      return next2();
    }
    const value = argument1;
    const next = argument3;
    validateValue(value);
    return next();
  };
  return middleware;
}

// src/router.ts
// @ts-ignore
import compose2 from "koa-compose";
// @ts-ignore
import HttpError from "http-errors";

// src/layer.ts
import { parse as parseUrl, format as formatUrl } from "url";

// src/utils/path-to-regexp-wrapper.ts
import { pathToRegexp, compile, parse } from "path-to-regexp";
function compilePathToRegexp(path: string, options: any = {}): { regexp: RegExp, keys: Key[] } {
  const normalizedOptions = { ...options };
  if ("strict" in normalizedOptions && !("trailing" in normalizedOptions)) {
    normalizedOptions.trailing = normalizedOptions.strict !== true;
    delete normalizedOptions.strict;
  }
  delete normalizedOptions.pathAsRegExp;
  delete normalizedOptions.ignoreCaptures;
  delete normalizedOptions.prefix;
  const { regexp, keys } = pathToRegexp(path, normalizedOptions);
  return { regexp, keys };
}
function compilePath(path: string, options: any = {}) {
  return compile(path, options);
}
function parsePath(path: string, options?: any) {
  return parse(path, options);
}
function normalizeLayerOptionsToPathToRegexp(options: LayerOptions = {}) {
  const normalized: { [name: string]: unknown } = {
    sensitive: options.sensitive,
    end: options.end,
    strict: options.strict,
    trailing: options.trailing
  };
  if ("strict" in normalized && !("trailing" in normalized)) {
    normalized.trailing = normalized.strict !== true;
    delete normalized.strict;
  }
  for (const key of Object.keys(normalized)) {
    if (normalized[key] === void 0) {
      delete normalized[key];
    }
  }
  return normalized;
}

// src/utils/safe-decode-uri-components.ts
function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// src/layer.ts
var Layer = class {
  opts: LayerOptions;
  name: string | undefined;
  methods: string[];
  paramNames: Key[];
  stack: Middleware[];
  path: string | RegExp;
  regexp!: RegExp;
  /**
   * Initialize a new routing Layer with given `method`, `path`, and `middleware`.
   *
   * @param path - Path string or regular expression
   * @param methods - Array of HTTP verbs
   * @param middleware - Layer callback/middleware or series of
   * @param opts - Layer options
   * @private
   */
  constructor(path: string | RegExp, methods: string[], middleware: Middleware | Middleware[], options: LayerOptions = {}) {
    this.opts = options;
    this.name = this.opts.name || void 0;
    this.methods = this._normalizeHttpMethods(methods);
    this.stack = this._normalizeAndValidateMiddleware(
      middleware,
      methods,
      path
    );
    this.path = path;
    this.paramNames = [];
    this._configurePathMatching();
  }
  /**
   * Normalize HTTP methods and add automatic HEAD support for GET
   * @private
   */
  _normalizeHttpMethods(methods: string[]): string[] {
    const normalizedMethods = [];
    for (const method of methods) {
      const upperMethod = method.toUpperCase();
      normalizedMethods.push(upperMethod);
      if (upperMethod === "GET") {
        normalizedMethods.unshift("HEAD");
      }
    }
    return normalizedMethods;
  }
  /**
   * Normalize middleware to array and validate all are functions
   * @private
   */
  _normalizeAndValidateMiddleware(middleware: Middleware | Middleware[], methods: string[], path: string | RegExp): Middleware[] {
    const middlewareArray = Array.isArray(middleware) ? middleware : [middleware];
    for (const middlewareFunction of middlewareArray) {
      const middlewareType = typeof middlewareFunction;
      if (middlewareType !== "function") {
        const routeIdentifier = this.opts.name || path;
        throw new Error(
          `${methods.toString()} \`${routeIdentifier}\`: \`middleware\` must be a function, not \`${middlewareType}\``
        );
      }
    }
    return middlewareArray;
  }
  /**
   * Configure path matching regexp and parameters
   * @private
   */
  _configurePathMatching() {
    if (this.opts.pathAsRegExp === true) {
      this.regexp = this.path instanceof RegExp ? this.path : new RegExp(this.path);
    } else if (this.path) {
      this._configurePathToRegexp();
    }
  }
  /**
   * Configure path-to-regexp for string paths
   * @private
   */
  _configurePathToRegexp() {
    const options = normalizeLayerOptionsToPathToRegexp(this.opts);
    const { regexp, keys } = compilePathToRegexp(this.path as string, options);
    this.regexp = regexp;
    this.paramNames = keys;
  }
  /**
   * Returns whether request `path` matches route.
   *
   * @param path - Request path
   * @returns Whether path matches
   * @private
   */
  match(path: string): boolean {
    return this.regexp.test(path);
  }
  /**
   * Returns map of URL parameters for given `path` and `paramNames`.
   *
   * @param _path - Request path (not used, kept for API compatibility)
   * @param captures - Captured values from regexp
   * @param existingParams - Existing params to merge with
   * @returns Parameter map
   * @private
   */
  params(_path: string, captures: string[], existingParameters: Parameters = {}): Parameters {
    const parameterValues: Parameters = { ...existingParameters };
    for (const [captureIndex, capturedValue] of captures.entries()) {
      const parameterDefinition = this.paramNames[captureIndex];
      if (parameterDefinition && capturedValue && capturedValue.length > 0) {
        const parameterName = parameterDefinition.name;
        if (this.opts.ignoreWildcardParameter === parameterName && parameterDefinition.type === "wildcard") {
          continue;
        }
        parameterValues[parameterName] = safeDecodeURIComponent(capturedValue);
      }
    }
    return parameterValues;
  }
  /**
   * Returns array of regexp url path captures.
   *
   * @param path - Request path
   * @returns Array of captured values
   * @private
   */
  captures(path: string): string[] {
    if (this.opts.ignoreCaptures) {
      return [];
    }
    const match = path.match(this.regexp);
    return match ? match.slice(1) : [];
  }
  /**
   * Generate URL for route using given `params`.
   *
   * @example
   *
   * ```javascript
   * const route = new Layer('/users/:id', ['GET'], fn);
   *
   * route.url({ id: 123 }); // => "/users/123"
   * ```
   *
   * @param args - URL parameters (various formats supported)
   * @returns Generated URL
   * @throws Error if route path is a RegExp (cannot generate URL from RegExp)
   * @private
   */
  url(...arguments_: any[]) {
    if (this.path instanceof RegExp) {
      throw new TypeError(
        "Cannot generate URL for routes defined with RegExp paths. Use string paths with named parameters instead."
      );
    }
    const { params, options } = this._parseUrlArguments(arguments_);
    const cleanPath = this.path.replaceAll("(.*)", "");
    const pathCompiler = compilePath(cleanPath, {
      encode: encodeURIComponent,
      ...options
    });
    const parameterReplacements = this._buildParamReplacements(
      params,
      cleanPath
    );
    const generatedUrl = pathCompiler(parameterReplacements);
    if (options && options.query) {
      return this._addQueryString(generatedUrl, options.query);
    }
    return generatedUrl;
  }
  /**
   * Parse url() arguments into params and options
   * Supports multiple call signatures:
   * - url({ id: 1 })
   * - url(1, 2, 3)
   * - url({ query: {...} })
   * - url({ id: 1 }, { query: {...} })
   * @private
   */
  _parseUrlArguments(allArguments: any) {
    let parameters = allArguments[0] ?? {};
    let options = allArguments[1];
    if (typeof parameters !== "object" || parameters === null) {
      const argumentsList = [...allArguments];
      const lastArgument = argumentsList.at(-1);
      if (typeof lastArgument === "object" && lastArgument !== null) {
        options = lastArgument;
        parameters = argumentsList.slice(0, -1);
      } else {
        parameters = argumentsList;
      }
    } else if (parameters && !options) {
      const parameterKeys = Object.keys(parameters);
      const isOnlyOptions = parameterKeys.length === 1 && parameterKeys[0] === "query";
      if (isOnlyOptions) {
        options = parameters;
        parameters = {};
      } else if ("query" in parameters && parameters.query) {
        const { query, ...restParameters } = parameters;
        options = { query };
        parameters = restParameters;
      }
    }
    return { params: parameters, options };
  }
  /**
   * Build parameter replacements for URL generation
   * @private
   */
  _buildParamReplacements(parameters: any, cleanPath: any) {
    const { tokens } = parsePath(cleanPath);
    const hasNamedParameters = tokens.some(
      (token) => "name" in token && token.name
    );
    const parameterReplacements: { [name: string]: string } = {};
    if (Array.isArray(parameters)) {
      let parameterIndex = 0;
      for (const token of tokens) {
        if ("name" in token && token.name) {
          parameterReplacements[token.name] = String(
            parameters[parameterIndex++]
          );
        }
      }
    } else if (hasNamedParameters && typeof parameters === "object" && !("query" in parameters)) {
      for (const [parameterName, parameterValue] of Object.entries(
        parameters
      )) {
        parameterReplacements[parameterName] = String(parameterValue);
      }
    }
    return parameterReplacements;
  }
  /**
   * Add query string to URL
   * @private
   */
  _addQueryString(baseUrl: any, query: any) {
    const parsed = parseUrl(baseUrl);
    const urlObject: any = {
      ...parsed,
      query: parsed.query ?? void 0
    };
    if (typeof query === "string") {
      urlObject.search = query;
      urlObject.query = void 0;
    } else {
      urlObject.search = void 0;
      urlObject.query = query;
    }
    return formatUrl(urlObject);
  }
  /**
   * Run validations on route named parameters.
   *
   * @example
   *
   * ```javascript
   * router
   *   .param('user', function (id, ctx, next) {
   *     ctx.user = users[id];
   *     if (!ctx.user) return ctx.status = 404;
   *     next();
   *   })
   *   .get('/users/:user', function (ctx, next) {
   *     ctx.body = ctx.user;
   *   });
   * ```
   *
   * @param paramName - Parameter name
   * @param paramHandler - Middleware function
   * @returns This layer instance
   * @private
   */
  param(parameterName: any, parameterHandler: any) {
    const middlewareStack = this.stack;
    const routeParameterNames = this.paramNames;
    const parameterMiddleware = this._createParamMiddleware(
      parameterName,
      parameterHandler
    );
    const parameterNamesList = routeParameterNames.map(
      (parameterDefinition: Key) => parameterDefinition.name
    );
    const parameterPosition = parameterNamesList.indexOf(parameterName);
    if (parameterPosition !== -1) {
      this._insertParamMiddleware(
        middlewareStack,
        parameterMiddleware,
        parameterNamesList,
        parameterPosition
      );
    }
    return this;
  }
  /**
   * Create param middleware with deduplication tracking
   * @private
   */
  _createParamMiddleware(parameterName: any, parameterHandler: any) {
    const middleware: Middleware = ((context: RouterContext, next: Next) => {
      if (!context._matchedParams) {
        context._matchedParams = /* @__PURE__ */ new WeakMap();
      }
      if (context._matchedParams.has(parameterHandler)) {
        return next();
      }
      context._matchedParams.set(parameterHandler, true);
      return parameterHandler(context.params![parameterName], context, next);
    });
    middleware.param = parameterName;
    middleware._originalFn = parameterHandler;
    return middleware;
  }
  /**
   * Insert param middleware at the correct position in the stack
   * @private
   */
  _insertParamMiddleware(middlewareStack: any, parameterMiddleware: any, parameterNamesList: any, currentParameterPosition: any) {
    let isInserted = false;
    for (let stackIndex = 0; stackIndex < middlewareStack.length; stackIndex++) {
      const existingMiddleware = middlewareStack[stackIndex];
      if (!existingMiddleware.param) {
        middlewareStack.splice(stackIndex, 0, parameterMiddleware);
        isInserted = true;
        break;
      }
      const existingParameterPosition = parameterNamesList.indexOf(
        existingMiddleware.param
      );
      if (existingParameterPosition > currentParameterPosition) {
        middlewareStack.splice(stackIndex, 0, parameterMiddleware);
        isInserted = true;
        break;
      }
    }
    if (!isInserted) {
      middlewareStack.push(parameterMiddleware);
    }
  }
  /**
   * Prefix route path.
   *
   * @param prefixPath - Prefix to prepend
   * @returns This layer instance
   * @private
   */
  setPrefix(prefixPath: any) {
    if (!this.path) {
      return this;
    }
    if (this.path instanceof RegExp) {
      return this;
    }
    this.path = this._applyPrefix(prefixPath);
    this._reconfigurePathMatching(prefixPath);
    return this;
  }
  /**
   * Apply prefix to the current path
   * @private
   */
  _applyPrefix(prefixPath: any) {
    const isRootPath = this.path === "/";
    const isStrictMode = this.opts.strict === true;
    const isPrefixHasParameters = prefixPath.includes(":");
    const isPathIsRawRegex = this.opts.pathAsRegExp === true && typeof this.path === "string";
    if (isPrefixHasParameters && isPathIsRawRegex) {
      const currentPath = this.path;
      if (currentPath === String.raw`(?:\/|$)` || currentPath === String.raw`(?:\\\/|$)`) {
        this.path = "{/*rest}";
        this.opts.pathAsRegExp = false;
      }
    }
    if (isRootPath && !isStrictMode) {
      return prefixPath;
    }
    return `${prefixPath}${this.path}`;
  }
  /**
   * Reconfigure path matching after prefix is applied
   * @private
   */
  _reconfigurePathMatching(prefixPath: any) {
    const isTreatAsRegExp = this.opts.pathAsRegExp === true;
    const prefixHasParameters = prefixPath && prefixPath.includes(":");
    if (prefixHasParameters && isTreatAsRegExp) {
      const options = normalizeLayerOptionsToPathToRegexp(this.opts);
      const { regexp, keys } = compilePathToRegexp(
        this.path as string,
        options
      );
      this.regexp = regexp;
      this.paramNames = keys;
      this.opts.pathAsRegExp = false;
    } else if (isTreatAsRegExp) {
      const pathString = this.path as string;
      const anchoredPattern = pathString.startsWith("^") ? pathString : `^${pathString}`;
      this.regexp = this.path instanceof RegExp ? this.path : new RegExp(anchoredPattern);
    } else {
      const options = normalizeLayerOptionsToPathToRegexp(this.opts);
      const { regexp, keys } = compilePathToRegexp(
        this.path as string,
        options
      );
      this.regexp = regexp;
      this.paramNames = keys;
    }
  }
};

// src/utils/http-methods.ts
import http from "http";
function getAllHttpMethods() {
  return http.METHODS.map((method) => method.toLowerCase());
}
var COMMON_HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "del",
  "head",
  "options"
];

// src/utils/parameter-helpers.ts
function normalizeParameterMiddleware(parameterMiddleware: any) {
  if (!parameterMiddleware) {
    return [];
  }
  if (Array.isArray(parameterMiddleware)) {
    return parameterMiddleware;
  }
  return [parameterMiddleware];
}
function applyParameterMiddlewareToRoute(route: any, parameterName: any, parameterMiddleware: any) {
  const middlewareList = normalizeParameterMiddleware(
    parameterMiddleware
  );
  for (const middleware of middlewareList) {
    route.param(parameterName, middleware);
  }
}
function applyAllParameterMiddleware(route: any, parametersObject: any) {
  const parameterNames = Object.keys(parametersObject);
  for (const parameterName of parameterNames) {
    const parameterMiddleware = parametersObject[parameterName];
    applyParameterMiddlewareToRoute(
      route,
      parameterName,
      parameterMiddleware
    );
  }
}

// src/utils/path-helpers.ts
function hasPathParameters(path: any, options = {}) {
  if (!path) {
    return false;
  }
  const { keys } = compilePathToRegexp(path, options);
  return keys.length > 0;
}
function determineMiddlewarePath(explicitPath: any, hasPrefixParameters: any) {
  if (explicitPath !== void 0) {
    if (typeof explicitPath === "string") {
      if (explicitPath === "") {
        return {
          path: "{/*rest}",
          pathAsRegExp: false
        };
      }
      if (explicitPath === "/") {
        return {
          path: "/",
          pathAsRegExp: false
        };
      }
      return {
        path: explicitPath,
        pathAsRegExp: false
      };
    }
    return {
      path: explicitPath,
      pathAsRegExp: true
    };
  }
  if (hasPrefixParameters) {
    return {
      path: "{/*rest}",
      pathAsRegExp: false
    };
  }
  return {
    path: String.raw`(?:\/|$)`,
    pathAsRegExp: true
  };
}

// src/utils/debug.ts
// @ts-ignore
import debugModule from "debug";
var debug = debugModule("koa-router");

// src/router.ts
var httpMethods = getAllHttpMethods();
var RouterImplementation = class {
  opts: RouterOptions;
  methods: string[];
  exclusive: boolean;
  params: { [name: string]: any };
  stack: LayerInstance[];
  host: string | string[] | RegExp | undefined;
  /**
   * Event emitter for router lifecycle events (experimental)
   * @internal
   */
  _events = new RouterEventEmitter();
  /**
   * Create a new router.
   *
   * @example
   *
   * Basic usage:
   *
   * ```javascript
   * const Koa = require('koa');
   * const Router = require('@koa/router');
   *
   * const app = new Koa();
   * const router = new Router();
   *
   * router.get('/', (ctx, next) => {
   *   // ctx.router available
   * });
   *
   * app
   *   .use(router.routes())
   *   .use(router.allowedMethods());
   * ```
   *
   * @alias module:koa-router
   * @param opts - Router options
   * @constructor
   */
  constructor(options: RouterOptions = {}) {
    this.opts = options;
    this.methods = this.opts.methods || [
      "HEAD",
      "OPTIONS",
      "GET",
      "PUT",
      "PATCH",
      "POST",
      "DELETE"
    ];
    this.exclusive = Boolean(this.opts.exclusive);
    this.params = {};
    this.stack = [];
    this.host = this.opts.host;
  }
  /**
   * Generate URL from url pattern and given `params`.
   *
   * @example
   *
   * ```javascript
   * const url = Router.url('/users/:id', {id: 1});
   * // => "/users/1"
   * ```
   *
   * @param path - URL pattern
   * @param args - URL parameters
   * @returns Generated URL
   */
  static url(path: any, ...arguments_: any[]) {
    const temporaryLayer = new Layer(path, [], () => {
    });
    return temporaryLayer.url(...arguments_);
  }
  use(...middleware: any[]) {
    if (this._isPathArray(middleware[0])) {
      return this._useWithPathArray(middleware);
    }
    let explicitPath;
    const hasExplicitPath = this._hasExplicitPath(middleware[0]);
    if (hasExplicitPath) {
      explicitPath = middleware.shift();
    }
    if (middleware.length === 0) {
      throw new Error(
        "You must provide at least one middleware function to router.use()"
      );
    }
    for (const currentMiddleware of middleware) {
      if (this._isNestedRouter(currentMiddleware)) {
        this._mountNestedRouter(
          currentMiddleware,
          explicitPath
        );
      } else {
        this._registerMiddleware(
          currentMiddleware,
          explicitPath,
          hasExplicitPath
        );
      }
    }
    return this;
  }
  /**
   * Check if first argument is an array of paths (all elements must be strings)
   * @private
   */
  _isPathArray(firstArgument: any) {
    return Array.isArray(firstArgument) && firstArgument.length > 0 && firstArgument.every((item) => typeof item === "string");
  }
  /**
   * Check if first argument is an explicit path (string or RegExp)
   * Empty string counts as explicit path to enable param capture
   * @private
   */
  _hasExplicitPath(firstArgument: any) {
    return typeof firstArgument === "string" || firstArgument instanceof RegExp;
  }
  /**
   * Check if middleware contains a nested router
   * @private
   */
  _isNestedRouter(middleware: any) {
    return typeof middleware === "function" && "router" in middleware && middleware.router !== void 0;
  }
  /**
   * Apply middleware to multiple paths
   * @private
   */
  _useWithPathArray(middleware: any) {
    const pathArray = middleware[0];
    const remainingMiddleware = middleware.slice(1);
    for (const singlePath of pathArray) {
      Reflect.apply(this.use, this, [singlePath, ...remainingMiddleware]);
    }
    return this;
  }
  /**
   * Mount a nested router
   * @private
   */
  _mountNestedRouter(middlewareWithRouter: any, mountPath: any) {
    const nestedRouter = middlewareWithRouter.router;
    const clonedRouter = this._cloneRouter(nestedRouter);
    const mountPathHasParameters = mountPath && typeof mountPath === "string" && hasPathParameters(mountPath, this.opts);
    for (let routeIndex = 0; routeIndex < clonedRouter.stack.length; routeIndex++) {
      const nestedLayer = clonedRouter.stack[routeIndex];
      const clonedLayer = this._cloneLayer(nestedLayer);
      if (mountPath && typeof mountPath === "string") {
        clonedLayer.setPrefix(mountPath);
      }
      if (this.opts.prefix) {
        clonedLayer.setPrefix(this.opts.prefix);
      }
      if (clonedLayer.methods.length === 0 && mountPathHasParameters) {
        clonedLayer.opts.ignoreCaptures = false;
      }
      this.stack.push(clonedLayer);
      clonedRouter.stack[routeIndex] = clonedLayer;
    }
    if (this.params) {
      this._applyParamMiddlewareToRouter(clonedRouter);
    }
  }
  /**
   * Clone a router instance
   * @private
   */
  _cloneRouter(sourceRouter: any) {
    return Object.assign(
      Object.create(Object.getPrototypeOf(sourceRouter)),
      sourceRouter,
      {
        stack: [...sourceRouter.stack]
      }
    );
  }
  /**
   * Clone a layer instance (deep clone to avoid shared references)
   * @private
   */
  _cloneLayer(sourceLayer: any) {
    const cloned = Object.assign(
      Object.create(Object.getPrototypeOf(sourceLayer)),
      sourceLayer,
      {
        // Deep clone arrays and objects to avoid shared references
        stack: [...sourceLayer.stack],
        methods: [...sourceLayer.methods],
        paramNames: [...sourceLayer.paramNames],
        opts: { ...sourceLayer.opts }
      }
    );
    return cloned;
  }
  /**
   * Apply this router's param middleware to a nested router
   * @private
   */
  _applyParamMiddlewareToRouter(targetRouter: any) {
    const parameterNames = Object.keys(this.params);
    for (const parameterName of parameterNames) {
      const parameterMiddleware = this.params[parameterName];
      applyParameterMiddlewareToRoute(
        targetRouter,
        parameterName,
        parameterMiddleware
      );
    }
  }
  /**
   * Register regular middleware (not nested router)
   * @private
   */
  _registerMiddleware(middleware: any, explicitPath: any, hasExplicitPath: any) {
    const isPrefixHasParameters = hasPathParameters(
      this.opts.prefix || "",
      this.opts
    );
    const effectiveExplicitPath = (() => {
      if (explicitPath !== void 0) return explicitPath;
      if (isPrefixHasParameters) return "";
      return;
    })();
    const isEffectiveHasExplicitPath = hasExplicitPath || explicitPath === void 0 && isPrefixHasParameters;
    const { path: middlewarePath, pathAsRegExp } = determineMiddlewarePath(
      effectiveExplicitPath,
      isPrefixHasParameters
    );
    let finalPath = middlewarePath;
    let isUsePathToRegexp = pathAsRegExp;
    const isRootPath = isEffectiveHasExplicitPath && middlewarePath === "/";
    if (isEffectiveHasExplicitPath && typeof middlewarePath === "string") {
      finalPath = middlewarePath;
      isUsePathToRegexp = false;
    }
    const ignoreWildcardParameter = effectiveExplicitPath === "" && middlewarePath === "{/*rest}" ? "rest" : void 0;
    this.register(finalPath, [], middleware, {
      end: isRootPath,
      ignoreCaptures: !isEffectiveHasExplicitPath && !isPrefixHasParameters,
      ignoreWildcardParameter,
      pathAsRegExp: isUsePathToRegexp
    });
  }
  /**
   * Set the path prefix for a Router instance that was already initialized.
   * Note: Calling this method multiple times will replace the prefix, not stack them.
   *
   * @example
   *
   * ```javascript
   * router.prefix('/things/:thing_id')
   * ```
   *
   * @param prefixPath - Prefix string
   * @returns This router instance
   */
  prefix(prefixPath: any) {
    const normalizedPrefix = prefixPath.replace(/\/$/, "");
    const previousPrefix = this.opts.prefix || "";
    this.opts.prefix = normalizedPrefix;
    for (const route of this.stack) {
      if (typeof route.path === "string" && previousPrefix) {
        const stripBoundary = previousPrefix + "/";
        if (route.path === previousPrefix || route.path.startsWith(stripBoundary)) {
          route.path = route.path.slice(previousPrefix.length) || "/";
        }
      }
      route.setPrefix(normalizedPrefix);
    }
    return this;
  }
  /**
   * Returns router middleware which dispatches a route matching the request.
   *
   * @returns Router middleware
   */
  middleware() {
    const dispatchMiddleware: Middleware = function(this: RouterInstance, context: RouterContext, next: Next) {
      debug("%s %s", context.method, context.path);
      if (!this.matchHost(context.host)) {
        return next();
      }
      const requestPath = this._getRequestPath(context);
      const matchResult = this.match(requestPath, context.method);
      this._storeMatchedRoutes(context, matchResult);
      context.router = this;
      context.routeMatched = matchResult.route;
      if (!matchResult.route) {
        return this._events.emit(
          RouterEvents.NotFound,
          context,
          next
        );
      }
      const matchedLayers = matchResult.pathAndMethod;
      this._setMatchedRouteInfo(context, matchedLayers);
      const middlewareChain = this._buildMiddlewareChain(
        matchedLayers,
        requestPath
      );
      return compose2(middlewareChain)(
        context,
        next
      );
    }.bind(this);
    dispatchMiddleware.router = this;
    return dispatchMiddleware;
  }
  /**
   * Get the request path to use for routing
   * @private
   */
  _getRequestPath(context: RouterContext): string {
    const context_ = context;
    return this.opts.routerPath || context_.newRouterPath || context_.path || (context_.routerPath as string | undefined) || "";
  }
  /**
   * Store matched routes on context
   * @private
   */
  _storeMatchedRoutes(context: RouterContext, matchResult: MatchResult) {
    const context_ = context;
    if (context_.matched) {
      context_.matched.push(...matchResult.path);
    } else {
      context_.matched = matchResult.path;
    }
  }
  /**
   * Set matched route information on context
   * @private
   */
  _setMatchedRouteInfo(context: RouterContext, matchedLayers: LayerInstance[]) {
    const context_ = context;
    const routeLayer = matchedLayers.toReversed().find((layer: LayerInstance) => layer.methods.length > 0);
    if (routeLayer) {
      context_._matchedRoute = routeLayer.path;
      if (routeLayer.name) {
        context_._matchedRouteName = routeLayer.name;
      }
    }
  }
  /**
   * Build middleware chain from matched layers
   * @private
   */
  _buildMiddlewareChain(matchedLayers: LayerInstance[], requestPath: string): Middleware[] {
    let layersToExecute: LayerInstance[];
    if (this.exclusive) {
      let chosenLayer;
      if (this.opts.exclusive === "specificity") {
        for (const layer of matchedLayers) {
          if (!chosenLayer || layer.paramNames.length < chosenLayer.paramNames.length) {
            chosenLayer = layer;
          }
        }
      } else {
        chosenLayer = matchedLayers.at(-1);
      }
      layersToExecute = chosenLayer ? [chosenLayer] : [];
    } else {
      layersToExecute = matchedLayers;
    }
    const middlewareChain = [];
    for (const layer of layersToExecute) {
      middlewareChain.push(
        (context: RouterContext, next: Next) => {
          const routerContext = context;
          routerContext.captures = layer.captures(requestPath);
          routerContext.request.params = layer.params(
            requestPath,
            routerContext.captures || [],
            routerContext.params
          );
          routerContext.params = routerContext.request.params;
          routerContext.routerPath = layer.path;
          routerContext.routerName = layer.name || void 0;
          routerContext._matchedRoute = layer.path;
          if (layer.name) {
            routerContext._matchedRouteName = layer.name;
          }
          return next();
        },
        ...layer.stack
      );
    }
    return middlewareChain;
  }
  routes() {
    return this.middleware();
  }
  /**
   * Register an event handler on the router.
   *
   * @experimental This API is experimental and may change in future versions.
   *
   * **Active events:**
   * - `'not-found'` — fires when no route matched path + method. Handlers are
   *   composed and called instead of `next()`, so they are responsible for
   *   calling `next()` themselves if they want to pass control downstream.
   *
   * @example
   *
   * All three forms are equivalent:
   *
   * ```javascript
   * import { RouterEvents } from '@koa/router';
   *
   * // Named constant (recommended — autocomplete + refactor safe)
   * router.on(RouterEvents.NotFound, handler);
   *
   * // Selector function (fluent style)
   * router.on((events) => events.NotFound, handler);
   *
   * // Raw string (still accepted)
   * router.on('not-found', handler);
   * ```
   *
   * Multiple handlers compose in registration order:
   *
   * ```javascript
   * router.on(RouterEvents.NotFound, async (ctx, next) => {
   *   console.log('no route matched', ctx.path);
   *   await next();
   * });
   * router.on(RouterEvents.NotFound, (ctx) => {
   *   ctx.status = 404;
   *   ctx.body = { error: 'Not Found' };
   * });
   * ```
   *
   * @param event - Event name string, `RouterEvents` constant, or selector
   *   function `(events) => events.NotFound` (see `RouterEventSelector`)
   * @param handler - Middleware to run when the event fires
   * @returns This router instance for chaining
   */
  on(event: any, handler: any) {
    this._events.register(resolveEvent(event), handler);
    return this;
  }
  /**
   * Returns separate middleware for responding to `OPTIONS` requests with
   * an `Allow` header containing the allowed methods, as well as responding
   * with `405 Method Not Allowed` and `501 Not Implemented` as appropriate.
   *
   * @example
   *
   * ```javascript
   * const Koa = require('koa');
   * const Router = require('@koa/router');
   *
   * const app = new Koa();
   * const router = new Router();
   *
   * app.use(router.routes());
   * app.use(router.allowedMethods());
   * ```
   *
   * **Example with [Boom](https://github.com/hapijs/boom)**
   *
   * ```javascript
   * const Koa = require('koa');
   * const Router = require('@koa/router');
   * const Boom = require('boom');
   *
   * const app = new Koa();
   * const router = new Router();
   *
   * app.use(router.routes());
   * app.use(router.allowedMethods({
   *   throw: true,
   *   notImplemented: () => new Boom.notImplemented(),
   *   methodNotAllowed: () => new Boom.methodNotAllowed()
   * }));
   * ```
   *
   * @param options - Options object
   * @returns Middleware function
   */
  allowedMethods(options: any = {}): Middleware {
    const implementedMethods = this.methods;
    return (context: RouterContext, next: Next) => {
      const routerContext = context;
      return next().then(() => {
        if (!this._shouldProcessAllowedMethods(routerContext)) {
          return;
        }
        const matchedRoutes = routerContext.matched || [];
        const allowedMethods = this._collectAllowedMethods(matchedRoutes);
        const allowedMethodsList = Object.keys(allowedMethods);
        const requestMethod = context.method.toUpperCase();
        if (!implementedMethods.includes(requestMethod)) {
          this._handleNotImplemented(
            routerContext,
            allowedMethodsList,
            options
          );
          return;
        }
        if (requestMethod === "OPTIONS" && allowedMethodsList.length > 0) {
          this._handleOptionsRequest(routerContext, allowedMethodsList);
          return;
        }
        if (allowedMethodsList.length > 0 && !allowedMethods[requestMethod]) {
          this._handleMethodNotAllowed(
            routerContext,
            allowedMethodsList,
            options
          );
        }
      });
    };
  }
  /**
   * Check if we should process allowed methods
   * @private
   */
  _shouldProcessAllowedMethods(context: RouterContext): boolean {
    return !!(context.matched && (!context.status || context.status === 404));
  }
  /**
   * Collect all allowed methods from matched routes
   * @private
   */
  _collectAllowedMethods(matchedRoutes: LayerInstance[]) {
    const allowedMethods: { [method: string]: string } = {};
    for (const route of matchedRoutes) {
      for (const method of route.methods) {
        allowedMethods[method] = method;
      }
    }
    return allowedMethods;
  }
  /**
   * Handle 501 Not Implemented response
   * @private
   */
  _handleNotImplemented(context: RouterContext, allowedMethodsList: string[], options: any) {
    if (options.throw) {
      const error = typeof options.notImplemented === "function" ? options.notImplemented() : new HttpError.NotImplemented();
      throw error;
    }
    context.status = 501;
    context.set("Allow", allowedMethodsList.join(", "));
  }
  /**
   * Handle OPTIONS request
   * @private
   */
  _handleOptionsRequest(context: RouterContext, allowedMethodsList: string[]) {
    context.status = 200;
    context.body = "";
    context.set("Allow", allowedMethodsList.join(", "));
  }
  /**
   * Handle 405 Method Not Allowed response
   * @private
   */
  _handleMethodNotAllowed(context: RouterContext, allowedMethodsList: string[], options: any) {
    if (options.throw) {
      const error = typeof options.methodNotAllowed === "function" ? options.methodNotAllowed() : new HttpError.MethodNotAllowed();
      throw error;
    }
    context.status = 405;
    context.set("Allow", allowedMethodsList.join(", "));
  }
  all(...arguments_: any[]) {
    let name;
    let path;
    let middleware;
    if (arguments_.length >= 2 && (typeof arguments_[1] === "string" || arguments_[1] instanceof RegExp)) {
      name = arguments_[0];
      path = arguments_[1];
      middleware = arguments_.slice(2);
    } else {
      name = void 0;
      path = arguments_[0];
      middleware = arguments_.slice(1);
    }
    if (typeof path !== "string" && !(path instanceof RegExp) && (!Array.isArray(path) || path.length === 0))
      throw new Error("You have to provide a path when adding an all handler");
    const routeOptions = {
      name,
      pathAsRegExp: path instanceof RegExp
    };
    this.register(path, httpMethods, middleware, {
      ...this.opts,
      ...routeOptions
    });
    return this;
  }
  /**
   * Redirect `source` to `destination` URL with optional 30x status `code`.
   *
   * Both `source` and `destination` can be route names.
   *
   * ```javascript
   * router.redirect('/login', 'sign-in');
   * ```
   *
   * This is equivalent to:
   *
   * ```javascript
   * router.all('/login', ctx => {
   *   ctx.redirect('/sign-in');
   *   ctx.status = 301;
   * });
   * ```
   *
   * @param source - URL or route name
   * @param destination - URL or route name
   * @param code - HTTP status code (default: 301)
   * @returns This router instance
   */
  redirect(source: any, destination: any, code: any) {
    let resolvedSource = source;
    let resolvedDestination = destination;
    if (typeof source === "symbol" || typeof source === "string" && source[0] !== "/") {
      const sourceUrl = this.url(source);
      if (sourceUrl instanceof Error) throw sourceUrl;
      resolvedSource = sourceUrl;
    }
    if (typeof destination === "symbol" || typeof destination === "string" && destination[0] !== "/" && !destination.includes("://")) {
      const destinationUrl = this.url(destination);
      if (destinationUrl instanceof Error) throw destinationUrl;
      resolvedDestination = destinationUrl;
    }
    const result = this.all(
      resolvedSource,
      (context: any) => {
        context.redirect(resolvedDestination);
        context.status = code || 301;
      }
    );
    return result;
  }
  /**
   * Create and register a route.
   *
   * @param path - Path string
   * @param methods - Array of HTTP verbs
   * @param middleware - Middleware functions
   * @param additionalOptions - Additional options
   * @returns Created layer
   * @private
   */
  register(path: any, methods: any, middleware: any, additionalOptions = {}) {
    const mergedOptions = { ...this.opts, ...additionalOptions };
    if (Array.isArray(path)) {
      return this._registerMultiplePaths(
        path,
        methods,
        middleware,
        mergedOptions
      );
    }
    const routeLayer = this._createRouteLayer(
      path,
      methods,
      middleware,
      mergedOptions
    );
    if (this.opts.prefix) {
      routeLayer.setPrefix(this.opts.prefix);
    }
    applyAllParameterMiddleware(routeLayer, this.params);
    this.stack.push(routeLayer);
    debug("defined route %s %s", routeLayer.methods, routeLayer.path);
    return routeLayer;
  }
  /**
   * Register multiple paths with the same configuration
   * @private
   */
  _registerMultiplePaths(pathArray: any, methods: any, middleware: any, options: any) {
    for (const singlePath of pathArray) {
      this.register.call(this, singlePath, methods, middleware, options);
    }
    return this;
  }
  /**
   * Create a route layer with given configuration
   * @private
   */
  _createRouteLayer(path: any, methods: any, middleware: any, options: any) {
    return new Layer(path, methods, middleware, {
      end: options.end === false ? options.end : true,
      name: options.name,
      sensitive: options.sensitive || false,
      strict: options.strict || false,
      prefix: options.prefix || "",
      ignoreCaptures: options.ignoreCaptures,
      ignoreWildcardParameter: options.ignoreWildcardParameter,
      pathAsRegExp: options.pathAsRegExp
    });
  }
  /**
   * Lookup route with given `name`.
   *
   * @param name - Route name
   * @returns Matched layer or false
   */
  route(name: any) {
    const matchingRoute = this.stack.find((route: LayerInstance) => route.name === name);
    return matchingRoute || false;
  }
  /**
   * Generate URL for route. Takes a route name and map of named `params`.
   *
   * @example
   *
   * ```javascript
   * router.get('user', '/users/:id', (ctx, next) => {
   *   // ...
   * });
   *
   * router.url('user', 3);
   * // => "/users/3"
   *
   * router.url('user', { id: 3 });
   * // => "/users/3"
   *
   * router.use((ctx, next) => {
   *   // redirect to named route
   *   ctx.redirect(ctx.router.url('sign-in'));
   * })
   *
   * router.url('user', { id: 3 }, { query: { limit: 1 } });
   * // => "/users/3?limit=1"
   *
   * router.url('user', { id: 3 }, { query: "limit=1" });
   * // => "/users/3?limit=1"
   * ```
   *
   * @param name - Route name
   * @param args - URL parameters
   * @returns Generated URL or Error
   */
  url(name: any, ...arguments_: any[]) {
    const route = this.route(name);
    if (route) return route.url(...arguments_);
    return new Error(`No route found for name: ${String(name)}`);
  }
  /**
   * Match given `path` and return corresponding routes.
   *
   * @param path - Request path
   * @param method - HTTP method
   * @returns Match result with matched layers
   * @private
   */
  match(path: string, method: string): MatchResult {
    const matchResult: MatchResult = {
      path: [],
      pathAndMethod: [],
      route: false
    };
    const normalizedMethod = method.toUpperCase();
    for (const layer of this.stack) {
      debug("test %s %s", layer.path, layer.regexp);
      if (layer.match(path)) {
        matchResult.path.push(layer);
        const isMiddleware = layer.methods.length === 0;
        const isMatchesMethod = layer.methods.includes(normalizedMethod);
        if (isMiddleware || isMatchesMethod) {
          matchResult.pathAndMethod.push(layer);
          if (layer.methods.length > 0) {
            matchResult.route = true;
          }
        }
      }
    }
    return matchResult;
  }
  /**
   * Match given `input` to allowed host
   * @param input - Host to check
   * @returns Whether host matches
   */
  matchHost(input: string | undefined): boolean {
    const { host } = this;
    if (!host) {
      return true;
    }
    if (!input) {
      return false;
    }
    if (typeof host === "string") {
      return input === host;
    }
    if (Array.isArray(host)) {
      return host.includes(input);
    }
    if (host instanceof RegExp) {
      return host.test(input);
    }
    return false;
  }
  /**
   * Run middleware for named route parameters. Useful for auto-loading or
   * validation.
   *
   * @example
   *
   * ```javascript
   * router
   *   .param('user', (id, ctx, next) => {
   *     ctx.user = users[id];
   *     if (!ctx.user) return ctx.status = 404;
   *     return next();
   *   })
   *   .get('/users/:user', ctx => {
   *     ctx.body = ctx.user;
   *   })
   *   .get('/users/:user/friends', ctx => {
   *     return ctx.user.getFriends().then(function(friends) {
   *       ctx.body = friends;
   *     });
   *   })
   *   // /users/3 => {"id": 3, "name": "Alex"}
   *   // /users/3/friends => [{"id": 4, "name": "TJ"}]
   * ```
   *
   * @param param - Parameter name
   * @param middleware - Parameter middleware
   * @returns This router instance
   */
  param(parameter: any, middleware: any) {
    if (!this.params[parameter]) {
      this.params[parameter] = [];
    }
    if (!Array.isArray(this.params[parameter])) {
      this.params[parameter] = [
        this.params[parameter]
      ];
    }
    this.params[parameter].push(middleware);
    for (const route of this.stack) {
      route.param(parameter, middleware);
    }
    return this;
  }
  /**
   * Helper method for registering HTTP verb routes
   * @internal - Used by dynamically added HTTP methods
   */
  _registerMethod(method: any, ...arguments_: any[]) {
    let name;
    let path;
    let middleware;
    if (arguments_.length >= 2 && (typeof arguments_[1] === "string" || arguments_[1] instanceof RegExp)) {
      name = arguments_[0];
      path = arguments_[1];
      middleware = arguments_.slice(2);
    } else {
      name = void 0;
      path = arguments_[0];
      middleware = arguments_.slice(1);
    }
    if (typeof path !== "string" && !(path instanceof RegExp) && (!Array.isArray(path) || path.length === 0))
      throw new Error(
        `You have to provide a path when adding a ${method} handler`
      );
    const options = {
      name,
      pathAsRegExp: path instanceof RegExp
    };
    this.register(path, [method], middleware, {
      ...this.opts,
      ...options
    });
    return this;
  }
  get(...arguments_: any[]) {
    return this._registerMethod("get", ...arguments_);
  }
  post(...arguments_: any[]) {
    return this._registerMethod("post", ...arguments_);
  }
  put(...arguments_: any[]) {
    return this._registerMethod("put", ...arguments_);
  }
  patch(...arguments_: any[]) {
    return this._registerMethod("patch", ...arguments_);
  }
  delete(...arguments_: any[]) {
    return this._registerMethod("delete", ...arguments_);
  }
  del(...arguments_: any[]) {
    return this.delete.apply(
      this,
      arguments_
    );
  }
  head(...arguments_: any[]) {
    return this._registerMethod("head", ...arguments_);
  }
  options(...arguments_: any[]) {
    return this._registerMethod("options", ...arguments_);
  }
};
var Router = RouterImplementation;
var router_default = Router;
for (const httpMethod of httpMethods) {
  const isAlreadyDefined = COMMON_HTTP_METHODS.includes(httpMethod) || httpMethod in RouterImplementation.prototype;
  if (!isAlreadyDefined) {
    Object.defineProperty(RouterImplementation.prototype, httpMethod, {
      value: function(...arguments_: any[]) {
        return this._registerMethod(httpMethod, ...arguments_);
      },
      writable: true,
      configurable: true,
      enumerable: false
    });
  }
}
export {
  Router,
  RouterEvents,
  createParameterValidationMiddleware,
  router_default as default
};

type LayerInstance = InstanceType<typeof Layer>;
type RouterInstance = InstanceType<typeof RouterImplementation>;
type Next = () => Promise<unknown>;
interface Middleware { (context: RouterContext, next: Next): unknown; param?: string; _originalFn?: unknown; router?: RouterInstance }
interface Key { name: string; type?: string }
interface Parameters { [name: string]: string }
interface MatchResult { path: LayerInstance[]; pathAndMethod: LayerInstance[]; route: boolean }
interface LayerOptions {
  name?: string | null; sensitive?: boolean; strict?: boolean; trailing?: boolean; end?: boolean; prefix?: string;
  ignoreCaptures?: boolean; pathAsRegExp?: boolean; ignoreWildcardParameter?: string;
}
interface RouterOptions {
  methods?: string[]; exclusive?: boolean | "specificity"; prefix?: string; host?: string | string[] | RegExp; routerPath?: string;
  sensitive?: boolean; strict?: boolean;
}
interface RouterContext {
  method: string; path: string; host: string; status: number; body: unknown;
  set(field: string, value: string): void;
  request: { params?: Parameters };
  router?: RouterInstance; routeMatched?: boolean; matched?: LayerInstance[]; newRouterPath?: string; routerPath?: string | RegExp; routerName?: string;
  captures?: string[]; params?: Parameters; _matchedRoute?: string | RegExp; _matchedRouteName?: string; _matchedParams?: WeakMap<object, boolean>;
}
