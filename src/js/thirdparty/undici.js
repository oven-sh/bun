const EventEmitter = require("node:events");
const StreamModule = require("node:stream");
const { Readable } = StreamModule;
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);
const { Buffer: $Buffer } = require("node:buffer");

var fetch = Bun.fetch;
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

  // No-op: real undici body ignores setEncoding and always yields Buffers
  setEncoding() {
    return this;
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
    opaque,
    context,
    // dispatcher,
  } = options;

  // TODO: More validations

  if (typeof url === "string") {
    // string URLs are validated; convert to URL object happens below if query is present
  } else if (typeof url === "object" && url !== null) {
    if (!(url instanceof URL)) {
      // TODO: Parse undici UrlObject
      throw new Error("not implemented");
    }
  } else throw new TypeError("url must be a string, URL, or UrlObject");

  if (typeof url === "string" && query) url = new URL(url);
  if (typeof url === "object" && url !== null && query) {
    const existingParams = new URLSearchParams(url.search);
    const newParams = new URLSearchParams(query);
    for (const [key, value] of newParams) {
      existingParams.set(key, value);
    }
    url.search = existingParams.toString();
  }

  method = method && typeof method === "string" ? method.toUpperCase() : null;
  // idempotent = idempotent === undefined ? method === "GET" || method === "HEAD" : idempotent;

  if (inputBody && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    // Collect readable stream into a buffer for fetch() body
    const chunks = [];
    for await (const chunk of inputBody) {
      chunks.push(typeof chunk === "string" ? $Buffer.from(chunk) : chunk);
    }
    inputBody = $Buffer.concat(chunks);
  }

  if (maxRedirections !== undefined && Number.isNaN(maxRedirections)) {
    throw new Error("maxRedirections must be a number if defined");
  }

  if (signal && !(signal instanceof AbortSignal)) {
    // TODO: Add support for event emitter signal
    throw new Error("signal must be an instance of AbortSignal");
  }

  let resp;
  /** @type {Response} */
  const { status: statusCode, headers } = (resp = await fetch(url, {
    signal,
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: maxRedirections !== undefined && maxRedirections > 0 ? "follow" : "manual",
    keepalive: !reset,
  }));

  // Throw if received 4xx or 5xx response indicating HTTP error
  if (throwOnError && statusCode >= 400 && statusCode < 600) {
    throw new Error(`Request failed with status code ${statusCode}`);
  }

  const body = resp.body ? new BodyReadable(resp) : Readable.from([]);

  // Strip content-encoding/content-length for auto-decompressed non-HEAD responses
  const responseHeaders = headers.toJSON();
  if (method !== "HEAD" && responseHeaders["content-encoding"]) {
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
  }

  return {
    statusCode,
    headers: responseHeaders,
    body,
    trailers: kEmptyObject,
    opaque: opaque ?? kEmptyObject,
    context: context ?? kEmptyObject,
  };
}

async function stream(url, factoryOrOptions, callbackOrFactory, maybeCallback) {
  // stream(url, options, factory, callback) overload
  let options = {};
  let factory = factoryOrOptions;
  let callback;
  if (typeof factoryOrOptions === "object" && factoryOrOptions !== null) {
    options = factoryOrOptions;
    factory = callbackOrFactory;
    callback = maybeCallback;
  } else {
    callback = callbackOrFactory;
  }

  const doStream = async () => {
    const {
      method = "GET",
      headers: inputHeaders,
      body: inputBody,
      signal,
      opaque,
      context,
      throwOnError,
      reset,
    } = options;

    let effectiveUrl = url;
    if (typeof effectiveUrl === "string") {
      if (options.path) {
        effectiveUrl = effectiveUrl.replace(/\/$/, "") + options.path;
      }
    } else if (effectiveUrl instanceof URL || (typeof effectiveUrl === "object" && effectiveUrl !== null)) {
      if (options.path) {
        effectiveUrl = new URL(options.path, effectiveUrl);
      }
    }

    // Merge query parameters if provided
    if (options.query) {
      const parsedUrl = new URL(effectiveUrl);
      const existingParams = new URLSearchParams(parsedUrl.search);
      const newParams = new URLSearchParams(options.query);
      for (const [key, value] of newParams) {
        existingParams.set(key, value);
      }
      parsedUrl.search = existingParams.toString();
      effectiveUrl = parsedUrl.toString();
    }

    const effectiveMethod = method ? method.toUpperCase() : "GET";

    // Collect Readable body into a Buffer for fetch()
    let resolvedBody = inputBody ?? null;
    if (resolvedBody && resolvedBody.read && resolvedBody instanceof Readable) {
      const chunks = [];
      for await (const chunk of resolvedBody) {
        chunks.push(typeof chunk === "string" ? $Buffer.from(chunk) : chunk);
      }
      resolvedBody = $Buffer.concat(chunks);
    }

    const resp = await fetch(effectiveUrl, {
      method: effectiveMethod,
      headers: inputHeaders || kEmptyObject,
      body: resolvedBody,
      signal: signal || undefined,
      redirect: "manual",
      keepalive: !reset,
    });

    const responseHeaders = resp.headers.toJSON();
    if (effectiveMethod !== "HEAD" && responseHeaders["content-encoding"]) {
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
    }

    // Throw on HTTP error if requested
    if (throwOnError && resp.status >= 400 && resp.status < 600) {
      if (resp.body) await resp.body.cancel();
      throw new Error(`Request failed with status code ${resp.status}`);
    }

    let writable;
    try {
      writable = factory({
        statusCode: resp.status,
        headers: responseHeaders,
        opaque,
      });
    } catch (factoryErr) {
      if (resp.body) await resp.body.cancel(factoryErr);
      throw factoryErr;
    }

    if (resp.body) {
      try {
        for await (const chunk of resp.body) {
          const buf = $Buffer.from(chunk);
          if (!writable.write(buf)) {
            await new Promise((resolve, reject) => {
              const onDrain = () => {
                cleanup();
                resolve();
              };
              const onError = err => {
                cleanup();
                reject(err);
              };
              const onClose = () => {
                cleanup();
                reject(new Error("writable closed before drain"));
              };
              const cleanup = () => {
                writable.removeListener("drain", onDrain);
                writable.removeListener("error", onError);
                writable.removeListener("close", onClose);
              };
              writable.once("drain", onDrain);
              writable.once("error", onError);
              writable.once("close", onClose);
            });
          }
        }
      } catch (err) {
        if (!writable.destroyed) writable.destroy(err);
        throw err;
      } finally {
        if (!writable.destroyed) writable.end();
      }
    } else {
      writable.end();
    }

    return {
      opaque: opaque !== undefined ? opaque : kEmptyObject,
      trailers: kEmptyObject,
      context: context !== undefined ? context : kEmptyObject,
    };
  };

  if ($isCallable(callback)) {
    doStream().then(
      data => callback(null, data),
      err => callback(err, null),
    );
    return;
  }

  return doStream();
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

class Dispatcher extends EventEmitter {}

// Body stream for Pool/Client responses.
// Shared helpers for Pool/Client
function _parseOrigin(originInput) {
  if (typeof originInput === "string") return originInput;
  if (originInput instanceof URL) return originInput.origin;
  if (typeof originInput === "object" && originInput !== null) {
    let proto = originInput.protocol || "http:";
    // Normalize protocol: strip slashes and ensure trailing colon
    proto = proto.replace(/[\/]+$/, "");
    if (!proto.endsWith(":")) proto += ":";
    const host = originInput.hostname || "localhost";
    const port = originInput.port ? `:${originInput.port}` : "";
    return `${proto}//${host}${port}`;
  }
  return String(originInput);
}

async function _doRequest(origin, opts) {
  const resolvedOrigin = _parseOrigin(opts.origin ?? origin).replace(/\/$/, "");
  const path = opts.path || "/";
  let url = resolvedOrigin + path;

  // Append query parameters if provided, preserving existing ones
  if (opts.query) {
    const parsedUrl = new URL(url);
    const existingParams = new URLSearchParams(parsedUrl.search);
    const newParams = new URLSearchParams(opts.query);
    for (const [key, value] of newParams) {
      existingParams.set(key, value);
    }
    parsedUrl.search = existingParams.toString();
    url = parsedUrl.toString();
  }

  const method = (opts.method || "GET").toUpperCase();
  const inputHeaders = opts.headers || kEmptyObject;
  let inputBody = opts.body ?? null;
  const signal = opts.signal || undefined;

  if (inputBody && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  // Collect Readable body into a Buffer for fetch()
  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    const chunks = [];
    for await (const chunk of inputBody) {
      chunks.push(typeof chunk === "string" ? $Buffer.from(chunk) : chunk);
    }
    inputBody = $Buffer.concat(chunks);
  }

  let resp;
  const { status: statusCode, headers } = (resp = await fetch(url, {
    method,
    headers: inputHeaders,
    body: inputBody,
    signal,
    redirect: "manual",
    keepalive: !opts.reset,
  }));

  // Throw on HTTP error if requested
  if (opts.throwOnError && statusCode >= 400 && statusCode < 600) {
    throw new Error(`Request failed with status code ${statusCode}`);
  }

  const body = resp.body ? new BodyReadable(resp) : Readable.from([]);

  const responseHeaders = headers.toJSON();
  if (method !== "HEAD" && responseHeaders["content-encoding"]) {
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
  }

  return {
    statusCode,
    headers: responseHeaders,
    body,
    trailers: kEmptyObject,
    opaque: opts.opaque !== undefined ? opts.opaque : kEmptyObject,
    context: opts.context !== undefined ? opts.context : kEmptyObject,
  };
}

class Agent extends Dispatcher {
  #options;
  constructor(options = {}) {
    super();
    this.#options = options;
  }
}

class Pool extends Dispatcher {
  #origin;
  #options;
  #closed;

  constructor(origin, options = {}) {
    super();
    this.#origin = _parseOrigin(origin);
    this.#options = options;
    this.#closed = false;
  }

  async request(opts) {
    if (this.#closed) {
      throw new ClientClosedError("The pool is closed");
    }
    return _doRequest(this.#origin, opts);
  }

  async close() {
    this.#closed = true;
  }

  async destroy() {
    this.#closed = true;
  }
}

class BalancedPool extends Pool {}

class Client extends Dispatcher {
  #origin;
  #options;
  #closed;

  constructor(origin, options = {}) {
    super();
    this.#origin = _parseOrigin(origin);
    this.#options = options;
    this.#closed = false;
  }

  async request(opts) {
    if (this.#closed) {
      throw new ClientClosedError("The client is closed");
    }
    return _doRequest(this.#origin, opts);
  }

  async close() {
    this.#closed = true;
  }

  async destroy() {
    this.#closed = true;
  }
}

class DispatcherBase extends EventEmitter {}

class ProxyAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class EnvHttpProxyAgent extends DispatcherBase {
  constructor() {
    super();
  }
}

class RetryAgent extends Dispatcher {
  constructor() {
    super();
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

// Add missing dispatcher functions
function setGlobalDispatcher(dispatcher) {
  globalDispatcher = dispatcher;
}

function getGlobalDispatcher() {
  return (globalDispatcher ??= new Dispatcher());
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
