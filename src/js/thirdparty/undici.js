const EventEmitter = require("node:events");
const { isIP } = require("node:net");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
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

// The shim's dispatchers expose their `connect` options through this symbol;
// dispatchers without it leave the request unchanged.
const kConnectFor = Symbol("kConnectFor");

function resolveConnect(dispatcher) {
  if (dispatcher == null) dispatcher = getGlobalDispatcher();
  if (dispatcher != null && typeof dispatcher[kConnectFor] === "function") {
    return dispatcher[kConnectFor]();
  }
  return undefined;
}

function runLookup(lookup, hostname, connect, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    let onAbort;
    const settle = fn => value => {
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const ok = settle(resolve);
    const fail = settle(reject);
    if (signal != null) {
      onAbort = () => fail(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      // The options net.connect passes to a custom lookup (family 0 = any).
      lookup(hostname, { family: connect.family ?? 0, hints: connect.hints ?? 0, all: false }, (err, address) => {
        if (err) return fail(err);
        if ($isArray(address)) {
          // `all: true` shape: [{ address, family }, ...]
          address = address.length > 0 ? address[0]?.address : undefined;
        }
        if (typeof address !== "string" || isIP(address) === 0) {
          return fail(
            new TypeError(`lookup did not return a valid IP address for "${hostname}" (received ${String(address)})`),
          );
        }
        ok(address);
      });
    } catch (e) {
      // A synchronous throw must still remove the abort listener.
      fail(e);
    }
  });
}

// request() also accepts the raw flat header form ["name", "value", ...],
// which the Headers constructor rejects.
function headersFromRequestOptions(inputHeaders) {
  if ($isArray(inputHeaders)) {
    const { length } = inputHeaders;
    if (length > 0 && typeof inputHeaders[0] === "string") {
      if (length % 2 !== 0) {
        throw new InvalidArgumentError("headers array must be even");
      }
      const headers = new Headers();
      for (let i = 0; i < length; i += 2) {
        headers.append(inputHeaders[i], inputHeaders[i + 1]);
      }
      return headers;
    }
  }
  return new Headers(inputHeaders || kEmptyObject);
}

// Pins `url` to the address from connect.lookup. `host` is the original
// authority, sent as the Host header; native fetch also takes SNI and
// certificate verification from it, so HTTPS still verifies the real hostname.
async function applyConnect(url, connect, signal) {
  const { protocol } = url;
  // Only http(s) opens a socket; data:, blob:, file: never consult the connector.
  if (protocol !== "http:" && protocol !== "https:") return undefined;
  if (typeof connect === "function") {
    throw new NotSupportedError("custom connect functions are not supported in Bun's undici compatibility layer");
  }
  const lookup = connect.lookup;
  if (typeof lookup !== "function") return undefined;
  const { hostname } = url;
  // URL#hostname keeps the brackets on IPv6 literals.
  const bare = hostname.charCodeAt(0) === 0x5b /* [ */ ? hostname.slice(1, -1) : hostname;
  if (isIP(bare) !== 0) return undefined;
  const address = await runLookup(lookup, bare, connect, signal);
  const host = url.host;
  const pinned = new URL(url);
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return { url: pinned, host };
}

function fetchFailed(cause) {
  // Codegen rewrites `new TypeError` to $makeTypeError, which drops the
  // options bag, so `cause` is defined manually (same attributes).
  const wrapped = new TypeError("fetch failed");
  ObjectDefineProperty(wrapped, "cause", {
    __proto__: null,
    configurable: true,
    enumerable: false,
    value: cause,
    writable: true,
  });
  return wrapped;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

// Follows the redirect chain from here (redirect: "manual" per hop) so the
// lookup hook sees every hostname; native fetch's own `follow` would resolve
// redirect targets with the OS resolver, bypassing the hook.
async function followRedirectsWithConnect(url, init, connect, opts) {
  let { method, body, headers, limit, redirectError, hopError, lookupError } = opts;
  const { signal } = init;
  method = typeof method === "string" ? method.toUpperCase() : "GET";
  for (let hops = 0; ; ) {
    let pin;
    try {
      pin = await applyConnect(url, connect, signal);
    } catch (err) {
      // An abort reason surfaces as-is, like native fetch rejecting on abort.
      if (signal?.aborted && err === signal.reason) throw err;
      throw lookupError(err);
    }
    const hopHeaders = new Headers(headers);
    let target = url.href;
    if (pin !== undefined) {
      target = pin.url.href;
      if (!hopHeaders.has("host")) hopHeaders.set("host", pin.host);
    }
    const resp = await nativeFetch(target, { ...init, method, headers: hopHeaders, body, redirect: "manual" });
    const { status } = resp;
    const location = isRedirectStatus(status) ? resp.headers.get("location") : null;
    if (location === null) {
      // The Response was fetched from the pinned IP with redirect: "manual";
      // report the logical URL and redirect state the caller asked about.
      ObjectDefineProperty(resp, "url", { __proto__: null, configurable: true, value: url.href });
      ObjectDefineProperty(resp, "redirected", { __proto__: null, configurable: true, value: hops > 0 });
      return resp;
    }
    // Intermediate response; release its connection now instead of at GC.
    resp.body?.cancel()?.$then(undefined, () => {});
    if (++hops > limit) throw redirectError();
    const next = new URL(location, url);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      // file:, data: and blob: targets never reach the lookup hook, and native
      // following rejects them too (UnsupportedRedirectProtocol).
      throw hopError(`cannot follow the ${status} redirect to ${next.href}: URL scheme must be http or https`);
    }
    if (next.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("proxy-authorization");
      headers.delete("cookie");
    }
    // A user-supplied Host header only applies to the original authority.
    headers.delete("host");
    if (
      (status === 303 && method !== "GET" && method !== "HEAD") ||
      ((status === 301 || status === 302) && method === "POST")
    ) {
      method = "GET";
      body = undefined;
      // The request-body-header names (https://fetch.spec.whatwg.org/#request-body-header-name).
      headers.delete("content-encoding");
      headers.delete("content-language");
      headers.delete("content-location");
      headers.delete("content-type");
      headers.delete("content-length");
    } else if (body instanceof ReadableStream || (typeof body?.pipe === "function" && typeof body?.on === "function")) {
      // Covers web ReadableStream and node:stream Readable bodies alike.
      throw hopError(
        `cannot follow the ${status} redirect to ${next.href}: the request body is a stream that was already sent; use a buffered body to follow redirects`,
      );
    }
    url = next;
  }
}

function fetchLookupError(err) {
  return err instanceof UndiciError ? err : fetchFailed(err);
}

async function fetchWithConnect(input, init, connect) {
  const isRequest = input instanceof Request;
  const url = new URL(isRequest ? input.url : input);
  const redirectMode = init?.redirect ?? (isRequest ? input.redirect : undefined) ?? "follow";
  const signal = init?.signal ?? (isRequest ? input.signal : undefined);
  if (redirectMode !== "follow") {
    // "manual" returns the 3xx and "error" rejects natively; neither follows
    // a redirect, so only the first hop needs pinning.
    let pin;
    try {
      pin = await applyConnect(url, connect, signal);
    } catch (err) {
      if (signal?.aborted && err === signal.reason) throw err;
      throw fetchLookupError(err);
    }
    if (pin === undefined) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
    if (!headers.has("host")) headers.set("host", pin.host);
    const resp = isRequest
      ? // Request's constructor reads `input` as an init dict: method/headers/body carry over.
        await nativeFetch(new Request(pin.url.href, input), { ...init, headers })
      : await nativeFetch(pin.url.href, { ...init, headers });
    ObjectDefineProperty(resp, "url", { __proto__: null, configurable: true, value: url.href });
    return resp;
  }
  const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
  const method = init?.method ?? (isRequest ? input.method : "GET");
  // Buffer a Request body so 307/308 hops can replay it.
  const body =
    init?.body !== undefined ? init.body : isRequest && input.body != null ? await input.arrayBuffer() : undefined;
  return followRedirectsWithConnect(url, { ...init, signal }, connect, {
    method,
    body,
    headers,
    limit: 20,
    redirectError: () => fetchFailed(new Error("redirect count exceeded")),
    hopError: message => fetchFailed(new Error(message)),
    lookupError: fetchLookupError,
  });
}

function fetch(input, init) {
  try {
    const connect = resolveConnect(init?.dispatcher);
    // Take over only when there is connect behaviour to apply (a lookup hook,
    // or a custom connector to reject); otherwise stay on the native path.
    if (connect == null || (typeof connect !== "function" && typeof connect.lookup !== "function")) {
      return nativeFetch(input, init);
    }
    return fetchWithConnect(input, init, connect);
  } catch (e) {
    return Promise.$reject(e);
  }
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

  if (maxRedirections != null && (!Number.isInteger(maxRedirections) || maxRedirections < 0)) {
    throw new Error("maxRedirections must be a positive number");
  }

  if (signal && !(signal instanceof AbortSignal)) {
    // TODO: Add support for event emitter signal
    throw new Error("signal must be an instance of AbortSignal");
  }

  const followRedirects = maxRedirections != null && maxRedirections > 0;

  const connect = resolveConnect(dispatcher);
  const hasLookup = connect != null && (typeof connect === "function" || typeof connect.lookup === "function");

  /** @type {Response} */
  let resp;
  if (hasLookup && followRedirects) {
    resp = await followRedirectsWithConnect(new URL(url), { signal, mode: "cors", keepalive: !reset }, connect, {
      method,
      body: inputBody,
      headers: headersFromRequestOptions(inputHeaders),
      limit: maxRedirections,
      redirectError: () => new Error("redirected too many times"),
      hopError: message => new Error(message),
      lookupError: err => err,
    });
  } else {
    let requestHeaders = inputHeaders || kEmptyObject;
    if (hasLookup) {
      const pin = await applyConnect(typeof url === "string" ? new URL(url) : url, connect, signal);
      if (pin !== undefined) {
        url = pin.url;
        requestHeaders = headersFromRequestOptions(inputHeaders);
        if (!requestHeaders.has("host")) requestHeaders.set("host", pin.host);
      }
    }
    resp = await nativeFetch(url, {
      signal,
      mode: "cors",
      method,
      headers: requestHeaders,
      body: inputBody,
      redirect: followRedirects ? "follow" : "manual",
      maxRedirects: followRedirects ? maxRedirections : undefined,
      keepalive: !reset,
    });
  }

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

class Dispatcher extends EventEmitter {}
class Agent extends Dispatcher {
  #connect;

  constructor(opts) {
    super();
    const connect = opts?.connect;
    if (connect != null && typeof connect !== "function" && typeof connect !== "object") {
      throw new InvalidArgumentError("connect must be a function or an object");
    }
    this.#connect = connect ?? undefined;
  }

  [kConnectFor]() {
    return this.#connect;
  }
}
class Pool extends Dispatcher {
  request() {}
}
class BalancedPool extends Dispatcher {}
class Client extends Dispatcher {
  request() {}
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
