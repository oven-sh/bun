const EventEmitter = require("node:events");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);

const nativeFetch = Bun.fetch;
const bindings = $cpp("Undici.cpp", "createUndiciInternalBinding");
const Response = bindings[0];
const Request = bindings[1];
const Headers = bindings[2];
const FormData = bindings[3];
const File = bindings[4];
const URL = bindings[5];
const AbortSignal = bindings[6];
const URLSearchParams = bindings[7];
const WebSocket = bindings[8];
const CloseEvent = bindings[9];
const ErrorEvent = bindings[10];
const MessageEvent = bindings[11];

class FileReader extends EventTarget {
  constructor() {
    super();
  }

  static EMPTY = 0;
  static LOADING = 1;
  static DONE = 2;
}

function notImplemented() {
  throw new Error("This function is not yet implemented in Bun");
}

// Proxying is the only dispatcher behaviour implemented: ProxyAgent returns a
// value for native fetch's `proxy` option here, every other dispatcher returns
// undefined and the request reaches native fetch (and its *_PROXY env) unchanged.
const kProxyFor = Symbol("kProxyFor");

function resolveProxy(dispatcher) {
  if (dispatcher == null) dispatcher = getGlobalDispatcher();
  if (dispatcher != null && typeof dispatcher[kProxyFor] === "function") {
    return dispatcher[kProxyFor]();
  }
  return undefined;
}

function fetch(input, init = undefined) {
  try {
    const proxy = resolveProxy(init?.dispatcher);
    // An explicit proxy wins, and a unix socket request cannot go through a proxy.
    if (proxy === undefined || (init != null && (init.proxy !== undefined || init.unix != null))) {
      return nativeFetch(input, init);
    }
    if (init == null) return nativeFetch(input, { proxy });
    // A Request as init cannot be spread (its fields are prototype getters);
    // fold it into the input instead so the proxy can be passed alongside.
    if (init instanceof Request) return nativeFetch(new Request(input, init), { proxy });
    return nativeFetch(input, { ...init, proxy });
  } catch (e) {
    return Promise.$reject(e);
  }
}
fetch.preconnect = nativeFetch.preconnect;

// Mirrors upstream util.parseURL for the UrlObject forms of request().
function urlFromUrlObject(obj) {
  let origin = obj.origin;
  if (origin == null) {
    const protocol = obj.protocol ?? "";
    const port = obj.port ?? (protocol === "https:" ? 443 : 80);
    origin = `${protocol}//${obj.hostname ?? ""}:${port}`;
  } else {
    origin = String(origin);
  }
  let path = obj.path ?? `${obj.pathname ?? ""}${obj.search ?? ""}`;
  path = String(path);
  if (origin.endsWith("/")) origin = origin.slice(0, -1);
  if (path && path[0] !== "/") path = "/" + path;
  try {
    return new URL(origin + path);
  } catch (cause) {
    throw new InvalidArgumentError(
      `Invalid URL ${JSON.stringify(origin + path)}: a UrlObject needs an origin, or a protocol and hostname`,
      { cause },
    );
  }
}

/**
 * An object representing a URL.
 * @typedef {Object} UrlObject
 * @property {string | number} [port]
 * @property {string} [path]
 * @property {string} [pathname]
 * @property {string} [hostname]
 * @property {string} [origin]
 * @property {string} [protocol]
 * @property {string} [search]
 */

/**
 * @typedef {import('http').IncomingHttpHeaders} IncomingHttpHeaders
 * @typedef {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} HttpMethod
 * @typedef {import('stream').Readable} Readable
 * @typedef {import('events').EventEmitter} EventEmitter
 */

function closeEmptyBody(controller) {
  controller.close();
}

class BodyReadable extends ReadableFromWeb {
  #response;
  #bodyUsed;

  constructor(response, options = {}) {
    // A response with no body (204, HEAD) still gets a body, as in undici:
    // https://github.com/nodejs/undici/blob/v6.21.3/lib/api/api-request.js#L118-L126
    super(options, response.body ?? new ReadableStream({ start: closeEmptyBody }));

    this.#response = response;
    this.#bodyUsed = response.bodyUsed;
  }

  get bodyUsed() {
    // return this.#response.bodyUsed;
    return this.#bodyUsed;
  }

  #consume() {
    if (this.#bodyUsed) throw new TypeError("unusable");
    this.#bodyUsed = true;
  }

  async arrayBuffer() {
    this.#consume();
    return await this.#response.arrayBuffer();
  }

  async blob() {
    this.#consume();
    return await this.#response.blob();
  }

  async formData() {
    this.#consume();
    return await this.#response.formData();
  }

  async json() {
    this.#consume();
    return await this.#response.json();
  }

  async text() {
    this.#consume();
    return await this.#response.text();
  }
}

// NOT IMPLEMENTED
// *   idempotent?: boolean;
// *   onInfo?: (info: { statusCode: number, headers: Object<string, string | string[]> }) => void;
// *   opaque?: *;
// *   responseHeader: 'raw' | null;
// *   headersTimeout?: number | null;
// *   bodyTimeout?: number | null;
// *   upgrade?: boolean | string | null;
// *   blocking?: boolean;

/**
 * Performs an HTTP request.
 * @param {string | URL | UrlObject} url
 * @param {{
 *   dispatcher: Dispatcher;
 *   method: HttpMethod;
 *   signal?: AbortSignal | EventEmitter | null;
 *   maxRedirections?: number;
 *   body?: string | Buffer | Uint8Array | Readable | null | FormData;
 *   headers?: IncomingHttpHeaders | string[] | null;
 *   query?: Record<string, any>;
 *   reset?: boolean;
 *   throwOnError?: boolean;
 * }} [options]
 * @returns {{
 *   statusCode: number;
 *   headers: IncomingHttpHeaders;
 *   body: ResponseBody;
 *   trailers: Object<string, string>;
 *   opaque: *;
 *   context: Object<string, *>;
 * }}
 */
async function request(
  url,
  options = {
    method: "GET",
    signal: null,
    headers: null,
    query: null,
    // idempotent: false, // GET and HEAD requests are idempotent by default
    // blocking = false,
    // upgrade = false,
    // headersTimeout: 30000,
    // bodyTimeout: 30000,
    reset: false,
    throwOnError: false,
    body: null,
    // dispatcher,
  },
) {
  let {
    method = "GET",
    headers: inputHeaders,
    query,
    signal,
    // idempotent, // GET and HEAD requests are idempotent by default
    // blocking = false,
    // upgrade = false,
    // headersTimeout = 30000,
    // bodyTimeout = 30000,
    reset = false,
    throwOnError = false,
    body: inputBody,
    maxRedirections,
    dispatcher,
  } = options;

  // TODO: More validations

  if (typeof url === "string") {
    if (query) url = new URL(url);
  } else if (typeof url === "object" && url !== null) {
    if (!(url instanceof URL)) {
      url = urlFromUrlObject(url);
    }
  } else throw new TypeError("url must be a string, URL, or UrlObject");

  if (typeof url === "string" && query) url = new URL(url);
  if (typeof url === "object" && url !== null && query) if (query) url.search = new URLSearchParams(query).toString();

  method = method && typeof method === "string" ? method.toUpperCase() : null;
  // idempotent = idempotent === undefined ? method === "GET" || method === "HEAD" : idempotent;

  if (inputBody && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  if (maxRedirections != null && (!Number.isInteger(maxRedirections) || maxRedirections < 0)) {
    throw new Error("maxRedirections must be a positive number");
  }

  if (signal && !(signal instanceof AbortSignal)) {
    // TODO: Add support for event emitter signal
    throw new Error("signal must be an instance of AbortSignal");
  }

  const followRedirects = maxRedirections != null && maxRedirections > 0;
  const proxy = resolveProxy(dispatcher);

  /** @type {Response} */
  const resp = await nativeFetch(url, {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !reset,
    proxy,
  });

  const { status: statusCode, headers, trailers } = resp;

  // Throw if received 4xx or 5xx response indicating HTTP error
  if (throwOnError && statusCode >= 400 && statusCode < 600) {
    throw new Error(`Request failed with status code ${statusCode}`);
  }

  const body = new BodyReadable(resp);

  return { statusCode, headers: headers.toJSON(), body, trailers, opaque: kEmptyObject, context: kEmptyObject };
}

function stream() {
  notImplemented();
}
function pipeline() {
  notImplemented();
}
function connect() {
  notImplemented();
}
function upgrade() {
  notImplemented();
}

class MockClient {
  constructor() {}
}
class MockPool {
  constructor() {}
}
class MockAgent {
  constructor() {}
}

function mockErrors() {}

class Dispatcher extends EventEmitter {
  #closed = false;
  #destroyed = false;

  dispatch() {
    notImplemented();
  }

  // `options` is both the UrlObject ({ origin, path }) and the request options.
  request(options, callback) {
    const p = request(options, { ...options, dispatcher: this });
    if (typeof callback === "function") {
      p.$then(
        data => callback(null, data),
        err => callback(err, null),
      );
      return;
    }
    return p;
  }

  close(callback) {
    this.#closed = true;
    if (typeof callback === "function") {
      queueMicrotask(callback);
      return;
    }
    return Promise.$resolve();
  }

  destroy(err, callback) {
    this.#destroyed = true;
    if (typeof err === "function") {
      callback = err;
    }
    if (typeof callback === "function") {
      queueMicrotask(callback);
      return;
    }
    return Promise.$resolve();
  }

  get closed() {
    return this.#closed;
  }

  get destroyed() {
    return this.#destroyed;
  }

  [kProxyFor]() {
    return undefined;
  }
}

class Agent extends Dispatcher {}
class BalancedPool extends Dispatcher {}

// Shared by Client and Pool, which are siblings upstream (a Pool is not a Client).
class OriginDispatcher extends Dispatcher {
  #origin;

  constructor(origin, _options) {
    super();
    if (!origin || (typeof origin !== "string" && !(origin instanceof URL))) {
      throw new InvalidArgumentError("Invalid URL: origin must be a non-empty string or URL");
    }
    try {
      this.#origin = new URL(origin).origin;
    } catch (cause) {
      throw new InvalidArgumentError(`Invalid URL: ${JSON.stringify(String(origin))}`, { cause });
    }
  }

  request(options, callback) {
    if (options != null && typeof options === "object" && !(options instanceof URL)) {
      options = { ...options, origin: this.#origin };
    }
    return super.request(options, callback);
  }
}

class Client extends OriginDispatcher {}
class Pool extends OriginDispatcher {}

class ProxyAgent extends Dispatcher {
  #proxy;

  constructor(opts) {
    super();
    if (typeof opts === "string" || opts instanceof URL) {
      opts = { uri: opts };
    }
    if (opts == null || typeof opts !== "object") {
      throw new InvalidArgumentError("Proxy uri is mandatory");
    }
    const { uri, token, auth } = opts;
    if (!uri || (typeof uri !== "string" && !(uri instanceof URL))) {
      throw new InvalidArgumentError("Proxy uri is mandatory");
    }
    if (token != null && auth != null) {
      throw new InvalidArgumentError("opts.auth cannot be used in combination with opts.token");
    }
    if (token != null && typeof token !== "string") {
      throw new InvalidArgumentError("opts.token must be a string");
    }
    if (auth != null && typeof auth !== "string") {
      throw new InvalidArgumentError("opts.auth must be a string");
    }
    const headers = opts.headers != null ? { ...opts.headers } : {};
    if (token != null) {
      headers["proxy-authorization"] = token;
    } else if (auth != null) {
      headers["proxy-authorization"] = `Basic ${auth}`;
    }
    this.#proxy = Object.keys(headers).length > 0 ? { url: String(uri), headers } : String(uri);
  }

  [kProxyFor]() {
    return this.#proxy;
  }
}

// Native fetch applies the *_PROXY env itself (per redirect hop), so this
// inherits the undefined kProxyFor; the per-instance overrides are unsupported.
class EnvHttpProxyAgent extends Dispatcher {
  constructor(opts) {
    super();
    if (opts != null && (opts.httpProxy != null || opts.httpsProxy != null || opts.noProxy != null)) {
      throw new Error(
        "EnvHttpProxyAgent's httpProxy/httpsProxy/noProxy options are not implemented in Bun; " +
          "set the HTTP_PROXY/HTTPS_PROXY/NO_PROXY environment variables or use ProxyAgent",
      );
    }
  }
}

class RetryAgent extends Dispatcher {
  #inner;

  constructor(dispatcher, _options) {
    super();
    if (dispatcher == null || typeof dispatcher !== "object") {
      throw new InvalidArgumentError("RetryAgent requires the dispatcher to wrap as its first argument");
    }
    this.#inner = dispatcher;
  }

  request(options, callback) {
    const inner = this.#inner;
    if (typeof inner.request === "function") return inner.request(options, callback);
    return super.request(options, callback);
  }

  [kProxyFor]() {
    return this.#inner[kProxyFor]?.();
  }
}

class RetryHandler {
  constructor() {}
}

class DecoratorHandler {
  constructor() {}
}

class RedirectHandler {
  constructor() {}
}

function createRedirectInterceptor() {
  return new RedirectHandler();
}

const interceptors = {
  redirect: () => {},
  retry: () => {},
  dump: () => {},
};

// Error classes
class UndiciError extends Error {}
class AbortError extends UndiciError {}
class HTTPParserError extends Error {}
class HeadersTimeoutError extends UndiciError {}
class HeadersOverflowError extends UndiciError {}
class BodyTimeoutError extends UndiciError {}
class RequestContentLengthMismatchError extends UndiciError {}
class ConnectTimeoutError extends UndiciError {}
class ResponseStatusCodeError extends UndiciError {}
// The one error this module throws itself; upstream's name/code so callers can branch on them.
class InvalidArgumentError extends UndiciError {
  constructor(message, options) {
    super(message, options);
    this.name = "InvalidArgumentError";
    this.code = "UND_ERR_INVALID_ARG";
  }
}
class InvalidReturnValueError extends UndiciError {}
class RequestAbortedError extends AbortError {}
class ClientDestroyedError extends UndiciError {}
class ClientClosedError extends UndiciError {}
class InformationalError extends UndiciError {}
class SocketError extends UndiciError {}
class NotSupportedError extends UndiciError {}
class ResponseContentLengthMismatchError extends UndiciError {}
class BalancedPoolMissingUpstreamError extends UndiciError {}
class ResponseExceededMaxSizeError extends UndiciError {}
class RequestRetryError extends UndiciError {}
class SecureProxyConnectionError extends UndiciError {}

const errors = {
  AbortError,
  HTTPParserError,
  UndiciError,
  HeadersTimeoutError,
  HeadersOverflowError,
  BodyTimeoutError,
  RequestContentLengthMismatchError,
  ConnectTimeoutError,
  ResponseStatusCodeError,
  InvalidArgumentError,
  InvalidReturnValueError,
  RequestAbortedError,
  ClientDestroyedError,
  ClientClosedError,
  InformationalError,
  SocketError,
  NotSupportedError,
  ResponseContentLengthMismatchError,
  BalancedPoolMissingUpstreamError,
  ResponseExceededMaxSizeError,
  RequestRetryError,
  SecureProxyConnectionError,
};

const util = {
  parseHeaders: () => {
    notImplemented();
  },
  headerNameToString: () => {
    notImplemented();
  },
};

class EventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor() {
    super();
  }
}

// Add missing cookie functions
function deleteCookie() {
  notImplemented();
}

function getCookies() {
  notImplemented();
}

function getSetCookies() {
  notImplemented();
}

function setCookie() {
  notImplemented();
}

// Add missing MIME type functions
function parseMIMEType() {
  notImplemented();
}

function serializeAMimeType() {
  notImplemented();
}

let globalDispatcher;

function setGlobalDispatcher(dispatcher) {
  globalDispatcher = dispatcher;
}

function getGlobalDispatcher() {
  return (globalDispatcher ??= new Agent());
}

// Add missing origin functions
function setGlobalOrigin() {}

function getGlobalOrigin() {}

// Create empty CacheStorage
const caches = {};

/**
 * Builds a connector function for making network connections
 * @param {Object} [options] Configuration options for the connector
 * @param {boolean} [options.rejectUnauthorized] Whether to reject unauthorized SSL/TLS connections
 * @param {number} [options.connectTimeout] Connection timeout in milliseconds
 * @param {number} [options.maxCachedSessions] Maximum number of cached TLS sessions
 * @param {boolean} [options.allowH2] Whether to allow HTTP/2 connections
 * @returns {function} A connector function
 */
function buildConnector(_options = {}) {
  /**
   * @param {Object} options
   * @param {string} options.hostname
   * @param {number} options.port
   * @param {string} [options.servername]
   * @param {AbortSignal} [options.signal]
   */
  return function connect(_) {
    notImplemented();
  };
}

// Update the exports to match the exact structure
const moduleExports = {
  Agent,
  BalancedPool,
  buildConnector,
  caches,
  Client,
  CloseEvent,
  connect,
  createRedirectInterceptor,
  DecoratorHandler,
  deleteCookie,
  Dispatcher,
  EnvHttpProxyAgent,
  ErrorEvent,
  errors,
  EventSource,
  fetch,
  File,
  FileReader,
  FormData,
  getCookies,
  getGlobalDispatcher,
  getGlobalOrigin,
  getSetCookies,
  Headers,
  interceptors,
  MessageEvent,
  MockAgent,
  MockClient,
  mockErrors,
  MockPool,
  parseMIMEType,
  pipeline,
  Pool,
  ProxyAgent,
  RedirectHandler,
  Request,
  request,
  Response,
  RetryAgent,
  RetryHandler,
  serializeAMimeType,
  setCookie,
  setGlobalDispatcher,
  setGlobalOrigin,
  stream,
  upgrade,
  util,
  WebSocket,
};

moduleExports.default = moduleExports;
export default moduleExports;
