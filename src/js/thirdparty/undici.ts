const EventEmitter = require("node:events");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);

var fetch: (input: string | URL | Request, init?: object) => Promise<Response> = Bun.fetch;
const bindings = $cpp("Undici.cpp", "createUndiciInternalBinding");
const Response: typeof globalThis.Response = bindings[0];
const Request: typeof globalThis.Request = bindings[1];
const Headers: typeof globalThis.Headers = bindings[2];
const FormData = bindings[3];
const File = bindings[4];
const URL: typeof globalThis.URL = bindings[5];
const AbortSignal: typeof globalThis.AbortSignal = bindings[6];
const URLSearchParams: typeof globalThis.URLSearchParams = bindings[7];
const WebSocket: typeof globalThis.WebSocket = bindings[8];
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

function notImplemented(): never {
  throw new Error("This function is not yet implemented in Bun");
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

function closeEmptyBody(controller: ReadableStreamDefaultController) {
  controller.close();
}

class BodyReadable extends ReadableFromWeb {
  #response: Response;
  #bodyUsed: boolean;

  constructor(response: Response, options: object = {}) {
    // A response with no body (204, HEAD) still gets a body, as in undici:
    // https://github.com/nodejs/undici/blob/v6.21.3/lib/api/api-request.js#L118-L126
    super({ ...options, responseBody: true }, response.body ?? new ReadableStream({ start: closeEmptyBody }));

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
interface RequestOptions {
  method?: string | null;
  signal?: AbortSignal | null;
  maxRedirections?: number;
  body?: $Node.BodyInit;
  headers?: $Node.HeadersInit | null;
  query?: ConstructorParameters<typeof globalThis.URLSearchParams>[0] | null;
  reset?: boolean;
  throwOnError?: boolean;
}

async function request(
  url: string | URL,
  options: RequestOptions = {
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
    // dispatcher,
  } = options;

  // TODO: More validations

  if (typeof url === "string") {
    if (query) url = new URL(url);
  } else if (typeof url === "object" && url !== null) {
    if (!(url instanceof URL)) {
      // TODO: Parse undici UrlObject
      if (!require("internal/url").isURL(url)) throw new Error("not implemented");
      url = new URL((url as URL).href);
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

  const resp: Response & { trailers?: undefined } = await fetch(url, {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !reset,
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

// https://github.com/nodejs/undici/blob/v8.12.4/lib/dispatcher/dispatcher.js
class Dispatcher extends EventEmitter {
  dispatch(_opts: object, _handler: object): boolean {
    throw new Error("not implemented");
  }
}
type DispatcherCallback = (err: Error | null, data: null) => void;

// https://github.com/nodejs/undici/blob/v8.12.4/lib/dispatcher/dispatcher-base.js
class DispatcherBase extends Dispatcher {
  close(callback?: DispatcherCallback) {
    if (callback === undefined) return Promise.$resolve(null);
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    queueMicrotask(() => callback(null, null));
  }

  destroy(err?: Error | DispatcherCallback | null, callback?: DispatcherCallback) {
    if (typeof err === "function") callback = err;
    if (callback === undefined) return Promise.$resolve(null);
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    queueMicrotask(() => callback(null, null));
  }
}
class Agent extends DispatcherBase {}
class Pool extends DispatcherBase {
  request() {}
}
class BalancedPool extends DispatcherBase {}
class RoundRobinPool extends DispatcherBase {}
class Client extends DispatcherBase {
  request() {}
}
class H2CClient extends Client {}

class ProxyAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class Socks5ProxyAgent extends DispatcherBase {}

class EnvHttpProxyAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class RetryAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class MockClient extends Client {}
class MockPool extends Pool {}
class MockAgent extends DispatcherBase {}
class SnapshotAgent extends MockAgent {}
class MockCallHistory {}
class MockCallHistoryLog {}

// https://github.com/nodejs/undici/blob/v8.12.4/lib/dispatcher/dispatcher1-wrapper.js
interface WrappedDispatcher extends Dispatcher {
  webSocketOptions?: object;
  eventSourceOptions?: object;
  close?(...args: unknown[]): unknown;
  destroy?(...args: unknown[]): unknown;
}

class Dispatcher1Wrapper extends Dispatcher {
  #dispatcher: WrappedDispatcher;

  constructor(dispatcher: WrappedDispatcher) {
    super();

    if (!dispatcher || typeof dispatcher.dispatch !== "function") {
      throw new InvalidArgumentError("Argument dispatcher must implement dispatch");
    }

    this.#dispatcher = dispatcher;
  }

  dispatch(opts: { allowH2?: boolean }, handler: object) {
    // Legacy (v1) consumers do not support HTTP/2, so force HTTP/1.1.
    if (opts.allowH2 !== false) {
      opts = { ...opts, allowH2: false };
    }

    return this.#dispatcher.dispatch(opts, handler);
  }

  get webSocketOptions() {
    return this.#dispatcher.webSocketOptions;
  }

  get eventSourceOptions() {
    return this.#dispatcher.eventSourceOptions;
  }

  close(...args: unknown[]) {
    return this.#dispatcher.close!(...args);
  }

  destroy(...args: unknown[]) {
    return this.#dispatcher.destroy!(...args);
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
  responseError: () => {},
  retry: () => {},
  dump: () => {},
  dns: () => {},
  cache: () => {},
  decompress: () => {},
  deduplicate: () => {},
};

class MemoryCacheStore {
  constructor() {
    notImplemented();
  }
}

class SqliteCacheStore {
  constructor() {
    notImplemented();
  }
}

const cacheStores = { MemoryCacheStore, SqliteCacheStore };

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
class InvalidArgumentError extends UndiciError {
  declare code: string;

  constructor(message?: string, options?: ErrorOptions) {
    super(message || "Invalid Argument Error", options);
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
class ProxyConnectionError extends UndiciError {}
class ResponseError extends UndiciError {}
class MaxRedirectsError extends UndiciError {}
class MaxOriginsReachedError extends UndiciError {}
class Socks5ProxyError extends UndiciError {}
class MessageSizeExceededError extends UndiciError {}
class WebAssemblyNotSupportedError extends Error {}
class MockNotMatchedError extends UndiciError {}

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
  ProxyConnectionError,
  ResponseError,
  MaxRedirectsError,
  MaxOriginsReachedError,
  Socks5ProxyError,
  MessageSizeExceededError,
  WebAssemblyNotSupportedError,
};

const mockErrors = { MockNotMatchedError };

const util = {
  parseHeaders: () => {
    notImplemented();
  },
  headerNameToString: () => {
    notImplemented();
  },
};

function ping(ws: WebSocket, body?: Buffer) {
  if (Buffer.isBuffer(body)) {
    if (body!.length > 125) throw new TypeError("A PING frame cannot have a body larger than 125 bytes.");
  } else if (body !== undefined) {
    throw new TypeError("Expected buffer payload");
  }
  if (!(ws instanceof WebSocket)) throw new TypeError("Expected a WebSocket");
  if (ws.readyState === WebSocket.OPEN) ws.ping(body);
}

// https://github.com/nodejs/undici/blob/v8.12.4/lib/web/websocket/stream/websocketerror.js
class WebSocketError extends DOMException {
  #closeCode: number | null;
  #reason: string;

  constructor(message = "", init: { closeCode?: number; reason?: string } | null = {}) {
    super(`${message}`, "WebSocketError");

    let code = init?.closeCode == null ? null : Math.trunc(Number(init.closeCode)) || 0;
    const reason = `${init?.reason ?? ""}`;

    if (code !== null && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException("invalid code", "InvalidAccessError");
    }
    const reasonBytesLength = Buffer.byteLength(reason);
    if (reasonBytesLength > 123) {
      throw new DOMException(`Reason must be less than 123 bytes; received ${reasonBytesLength}`, "SyntaxError");
    }

    if (reason.length !== 0 && code === null) {
      code = 1000;
    }

    this.#closeCode = code;
    this.#reason = reason;
  }

  get closeCode() {
    return this.#closeCode;
  }

  get reason() {
    return this.#reason;
  }
}

Object.defineProperties(WebSocketError.prototype, {
  closeCode: { enumerable: true },
  reason: { enumerable: true },
  [Symbol.toStringTag]: { value: "WebSocketError", writable: false, enumerable: false, configurable: true },
});

class WebSocketStream {
  constructor() {
    notImplemented();
  }
}

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

function parseCookie() {
  notImplemented();
}

// Add missing MIME type functions
function parseMIMEType() {
  notImplemented();
}

function serializeAMimeType() {
  notImplemented();
}

let globalDispatcher: Dispatcher | undefined;

// Add missing dispatcher functions
function setGlobalDispatcher(dispatcher: Dispatcher) {
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
function buildConnector(_options: object = {}) {
  /**
   * @param {Object} options
   * @param {string} options.hostname
   * @param {number} options.port
   * @param {string} [options.servername]
   * @param {AbortSignal} [options.signal]
   */
  return function connect(_options: object) {
    notImplemented();
  };
}

// https://github.com/nodejs/undici/blob/v8.12.4/index.js, minus EventSource: the shim's cannot connect.
function install() {
  globalThis.fetch = fetch as typeof globalThis.fetch;
  globalThis.Headers = Headers;
  globalThis.Response = Response;
  globalThis.Request = Request;
  globalThis.FormData = FormData;
  globalThis.WebSocket = WebSocket;
  globalThis.CloseEvent = CloseEvent;
  globalThis.ErrorEvent = ErrorEvent;
  globalThis.MessageEvent = MessageEvent;
}

// Update the exports to match the exact structure
const moduleExports = {
  Agent,
  BalancedPool,
  buildConnector,
  caches,
  cacheStores,
  Client,
  CloseEvent,
  connect,
  createRedirectInterceptor,
  DecoratorHandler,
  deleteCookie,
  Dispatcher,
  Dispatcher1Wrapper,
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
  H2CClient,
  Headers,
  install,
  interceptors,
  MessageEvent,
  MockAgent,
  MockCallHistory,
  MockCallHistoryLog,
  MockClient,
  mockErrors,
  MockPool,
  parseCookie,
  parseMIMEType,
  ping,
  pipeline,
  Pool,
  ProxyAgent,
  RedirectHandler,
  Request,
  request,
  Response,
  RetryAgent,
  RetryHandler,
  RoundRobinPool,
  serializeAMimeType,
  setCookie,
  setGlobalDispatcher,
  setGlobalOrigin,
  SnapshotAgent,
  Socks5ProxyAgent,
  stream,
  upgrade,
  util,
  WebSocket,
  WebSocketError,
  WebSocketStream,
};

(moduleExports as typeof moduleExports & { default?: unknown }).default = moduleExports;
export default moduleExports;
