const EventEmitter = require("node:events");
const StreamModule = require("node:stream");
const { Readable } = StreamModule;
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

// Dispatchers in Bun's undici shim translate to the native fetch `proxy` option.
// A dispatcher that can express itself as a proxy exposes this method; it
// receives the target URL and returns the value to pass as `proxy` (string,
// URL, `{url, headers}` object, "" for direct) or `undefined` to defer. Native
// fetch still applies ambient NO_PROXY to a non-empty proxy value (see
// ProxySettings::from_explicit), so ProxyAgent inherits that behaviour.
const kProxyFor = Symbol("kProxyFor");

function resolveProxy(dispatcher, url) {
  if (dispatcher == null) dispatcher = getGlobalDispatcher();
  if (dispatcher != null && typeof dispatcher[kProxyFor] === "function") {
    return dispatcher[kProxyFor](url);
  }
  return undefined;
}

function applyDispatcher(url, options) {
  const dispatcher = options?.dispatcher;
  const proxy = resolveProxy(dispatcher, url);
  if (proxy === undefined) return options;
  if (options == null) return { proxy };
  // Bun's fetch(url, Request) reads method/headers/body via prototype getters;
  // spreading a Request yields `{}`, so pass it through untouched.
  if (options instanceof Request) return options;
  // Don't clobber a caller-provided Bun proxy option.
  if (options.proxy !== undefined) return options;
  return { ...options, proxy };
}

function fetch(input, init) {
  // `input` may be a Request; dispatchers that inspect the target URL need the
  // string href, not the Request object, so normalize before resolving proxy.
  const url = input instanceof Request ? input.url : input;
  return nativeFetch(input, applyDispatcher(url, init));
}
fetch.preconnect = nativeFetch.preconnect;

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

class BodyReadable extends ReadableFromWeb {
  #response;
  #bodyUsed;

  constructor(response, options = {}) {
    var { body } = response;
    if (!body) throw new Error("Response body is null");
    super(options, body);

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
      // TODO: Parse undici UrlObject
      throw new Error("not implemented");
    }
  } else throw new TypeError("url must be a string, URL, or UrlObject");

  if (typeof url === "string" && query) url = new URL(url);
  if (typeof url === "object" && url !== null && query) if (query) url.search = new URLSearchParams(query).toString();

  method = method && typeof method === "string" ? method.toUpperCase() : null;
  // idempotent = idempotent === undefined ? method === "GET" || method === "HEAD" : idempotent;

  if (inputBody && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    // TODO: Streaming via ReadableStream?
    let data = "";
    inputBody.setEncoding("utf8");
    for await (const chunk of stream) {
      data += chunk;
    }
    inputBody = new TextEncoder().encode(data);
  }

  if (maxRedirections != null && (!Number.isInteger(maxRedirections) || maxRedirections < 0)) {
    throw new Error("maxRedirections must be a positive number");
  }

  if (signal && !(signal instanceof AbortSignal)) {
    // TODO: Add support for event emitter signal
    throw new Error("signal must be an instance of AbortSignal");
  }

  const followRedirects = maxRedirections != null && maxRedirections > 0;
  const proxy = resolveProxy(dispatcher, url);

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

  const body = resp.body ? new BodyReadable(resp) : null;

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
  dispatch() {
    throw new Error(
      "Dispatcher.dispatch() is not implemented in Bun's builtin undici. " +
        "Use fetch()/request() with a ProxyAgent dispatcher, or install undici from npm.",
    );
  }

  request(options, callback) {
    let url = options;
    let opts;
    if (options != null && typeof options === "object" && !(options instanceof URL)) {
      const { origin, path, ...rest } = options;
      if (origin != null) {
        // URL serialization always emits a trailing slash; strip it so
        // `{origin: new URL(...), path: "/x"}` doesn't produce `//x`.
        let o = String(origin);
        if (o.endsWith("/")) o = o.slice(0, -1);
        url = o + (path ?? "");
      } else {
        url = path;
      }
      opts = rest;
    }
    const p = request(url, { ...opts, dispatcher: this });
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
    if (typeof callback === "function") {
      queueMicrotask(callback);
      return;
    }
    return Promise.$resolve();
  }

  destroy(err, callback) {
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
    return false;
  }

  get destroyed() {
    return false;
  }

  [kProxyFor](_url) {
    return undefined;
  }
}

class Agent extends Dispatcher {}
class BalancedPool extends Dispatcher {}

class Client extends Dispatcher {
  #origin;

  constructor(origin, _options) {
    super();
    if (origin == null || (typeof origin !== "string" && !(origin instanceof URL))) {
      throw new InvalidArgumentError("Invalid URL: origin must be a non-empty string or URL");
    }
    this.#origin = new URL(origin).origin;
  }

  request(options, callback) {
    if (options != null && typeof options === "object" && !(options instanceof URL)) {
      options = { ...options, origin: this.#origin };
    }
    return super.request(options, callback);
  }
}

class Pool extends Client {}

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
    if (uri == null || (typeof uri !== "string" && !(uri instanceof URL))) {
      throw new InvalidArgumentError("Proxy uri is mandatory");
    }
    if (token != null && auth != null) {
      throw new InvalidArgumentError("opts.auth cannot be used in combination with opts.token");
    }
    let headers;
    if (typeof token === "string") {
      headers = { "proxy-authorization": token };
    } else if (typeof auth === "string") {
      headers = { "proxy-authorization": `Basic ${auth}` };
    }
    this.#proxy = headers ? { url: String(uri), headers } : String(uri);
  }

  [kProxyFor](_url) {
    return this.#proxy;
  }
}

class EnvHttpProxyAgent extends Dispatcher {
  #httpProxy;
  #httpsProxy;
  #noProxy;

  constructor(opts = kEmptyObject) {
    super();
    const env = process.env;
    this.#httpProxy = opts.httpProxy ?? env.http_proxy ?? env.HTTP_PROXY;
    this.#httpsProxy = opts.httpsProxy ?? env.https_proxy ?? env.HTTPS_PROXY;
    const noProxy = opts.noProxy ?? env.no_proxy ?? env.NO_PROXY;
    this.#noProxy =
      typeof noProxy === "string" && noProxy.length > 0
        ? noProxy
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(Boolean)
        : [];
  }

  #isNoProxy(url) {
    const list = this.#noProxy;
    if (list.length === 0) return false;
    if (list.includes("*")) return true;
    let hostname, port;
    try {
      ({ hostname, port } = new URL(url));
    } catch {
      return false;
    }
    hostname = hostname.toLowerCase();
    const hostport = port ? `${hostname}:${port}` : hostname;
    for (let entry of list) {
      if (entry === hostname || entry === hostport) return true;
      if (entry[0] === ".") entry = entry.slice(1);
      if (hostname.endsWith("." + entry)) return true;
    }
    return false;
  }

  [kProxyFor](url) {
    if (this.#isNoProxy(url)) return "";
    const https = typeof url === "string" ? url.startsWith("https:") : url?.protocol === "https:";
    const proxy = https ? (this.#httpsProxy ?? this.#httpProxy) : this.#httpProxy;
    return proxy ?? "";
  }
}

class RetryAgent extends Dispatcher {
  #inner;

  constructor(dispatcher, _options) {
    super();
    this.#inner = dispatcher;
  }

  [kProxyFor](url) {
    return this.#inner?.[kProxyFor]?.(url);
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
class InvalidArgumentError extends UndiciError {}
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
  if (dispatcher == null || typeof dispatcher.dispatch !== "function") {
    throw new InvalidArgumentError("Argument agent must implement Agent");
  }
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
