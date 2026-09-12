const EventEmitter = require("node:events");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");
const { validateNumber } = require("internal/validators");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);

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
const { AbortController, DOMException, Event, TextDecoder, clearTimeout, decodeURIComponent, setTimeout } = globalThis;

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
    // dispatcher,
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

  /** @type {Response} */
  const resp = await fetch(url, {
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
class Agent extends Dispatcher {}
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

const kConnecting = 0;
const kOpen = 1;
const kClosed = 2;
// Same default as undici and Chromium.
const kDefaultReconnectionTime = 3000;
// setTimeout() treats anything wider than an i32 as 1ms, which would turn a huge `retry:` into a busy loop.
const kMaxReconnectionTime = 2 ** 31 - 1;

function isASCIIDigits(value) {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return true;
}

function isEventStreamContentType(contentType) {
  if (contentType === null) return false;
  const semicolon = contentType.indexOf(";");
  const essence = semicolon === -1 ? contentType : contentType.slice(0, semicolon);
  // Only HTTP whitespace may surround the type; String#trim would also strip characters the MIME parser rejects.
  return essence.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "").toLowerCase() === "text/event-stream";
}

function percentDecode(component) {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}

// https://fetch.spec.whatwg.org/#concept-url-converted-to-authorization-value
function basicAuthorizationFor(url) {
  if (url.username === "" && url.password === "") return null;
  return "Basic " + Buffer.from(`${percentDecode(url.username)}:${percentDecode(url.password)}`).toString("base64");
}

// Header values are byte strings (one byte per code unit); this spells out a string's UTF-8 bytes as one.
function utf8ByteString(string) {
  return Buffer.from(string).toString("latin1");
}

// https://html.spec.whatwg.org/multipage/server-sent-events.html
class EventSource extends EventTarget {
  #url;
  // Only reflected: fetch() in Bun has no ambient credentials (cookies) for this to include or omit, same as in undici.
  #withCredentials = false;
  #readyState = kConnecting;
  #lastEventId = "";
  #reconnectionTime = kDefaultReconnectionTime;
  // Credentials from the URL as an Authorization value, sent once a 401 has asked for them (#challenged).
  #authorization = null;
  #challenged = false;

  // The current connection. Async continuations compare against it, so a closed or superseded connection is inert.
  #controller = null;
  #reconnectTimer = null;

  // Per-connection state, reset in #readBody().
  #origin = "";
  #decoder = null;
  #partialLine = "";
  #skipLF = false;
  #dataBuffer = "";
  #eventTypeBuffer = "";
  #lastEventIdBuffer = "";

  // on{open,message,error} handler values, plus the listener registered on behalf of each non-null one.
  #handlers = { __proto__: null, open: null, message: null, error: null };
  #handlerListeners = { __proto__: null, open: null, message: null, error: null };

  constructor(url, init) {
    super();
    if (arguments.length === 0) {
      throw new TypeError("EventSource constructor: 1 argument required, but only 0 present.");
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new DOMException(`Cannot open an EventSource to '${url}'. The URL is invalid.`, "SyntaxError");
    }
    this.#url = parsed.href;
    this.#authorization = basicAuthorizationFor(parsed);

    if (init !== undefined && init !== null) {
      if (!$isObject(init)) {
        throw new TypeError("EventSource constructor: the second argument must be a dictionary.");
      }
      this.#withCredentials = !!init.withCredentials;
      // undici extension: `{ node: { reconnectionTime } }` overrides the delay used until the server sends `retry:`.
      const reconnectionTime = init.node?.reconnectionTime;
      if (reconnectionTime !== undefined) {
        validateNumber(reconnectionTime, "init.node.reconnectionTime", 0, kMaxReconnectionTime);
        this.#reconnectionTime = reconnectionTime;
      }
    }

    this.#connect();
  }

  get url() {
    return this.#url;
  }

  get withCredentials() {
    return this.#withCredentials;
  }

  get readyState() {
    return this.#readyState;
  }

  close() {
    if (this.#readyState === kClosed) return;
    this.#readyState = kClosed;
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#abort();
  }

  get onopen() {
    return this.#handlers.open;
  }
  set onopen(value) {
    this.#setHandler("open", value);
  }

  get onmessage() {
    return this.#handlers.message;
  }
  set onmessage(value) {
    this.#setHandler("message", value);
  }

  get onerror() {
    return this.#handlers.error;
  }
  set onerror(value) {
    this.#setHandler("error", value);
  }

  #setHandler(type, value) {
    // EventHandler IDL attributes keep any object (even a non-callable one) and turn everything else into null.
    if (!$isObject(value)) value = null;
    this.#handlers[type] = value;

    if (value !== null) {
      if (this.#handlerListeners[type] !== null) return;
      const listener = event => {
        const handler = this.#handlers[type];
        if ($isCallable(handler)) handler.$call(this, event);
      };
      this.#handlerListeners[type] = listener;
      super.addEventListener(type, listener);
    } else if (this.#handlerListeners[type] !== null) {
      super.removeEventListener(type, this.#handlerListeners[type]);
      this.#handlerListeners[type] = null;
    }
  }

  #abort() {
    const controller = this.#controller;
    if (controller === null) return;
    this.#controller = null;
    controller.abort();
  }

  #connect() {
    const controller = new AbortController();
    this.#controller = controller;

    const headers = new Headers({ "accept": "text/event-stream", "cache-control": "no-cache" });
    if (this.#challenged) headers.set("authorization", this.#authorization);
    if (this.#lastEventId !== "") headers.set("last-event-id", utf8ByteString(this.#lastEventId));

    fetch(this.#url, { headers, signal: controller.signal }).then(
      response => {
        if (this.#controller !== controller) return;
        this.#onResponse(controller, response);
      },
      () => {
        if (this.#controller !== controller) return;
        this.#reestablish();
      },
    );
  }

  #onResponse(controller, response) {
    if (response.status === 401 && this.#authorization !== null && !this.#challenged) {
      this.#challenged = true;
      this.#abort();
      this.#connect();
      return;
    }
    if (response.status !== 200 || !isEventStreamContentType(response.headers.get("content-type"))) {
      this.#fail();
      return;
    }

    this.#readyState = kOpen;
    super.dispatchEvent(new Event("open"));
    // The open handler may have called close().
    if (this.#controller !== controller) return;

    this.#readBody(controller, response);
  }

  async #readBody(controller, response) {
    // Events carry the origin of the URL that actually served the stream, which may differ from #url after redirects.
    this.#origin = new URL(response.url || this.#url).origin;
    this.#decoder = new TextDecoder();
    this.#partialLine = "";
    this.#skipLF = false;
    this.#dataBuffer = "";
    this.#eventTypeBuffer = "";
    this.#lastEventIdBuffer = this.#lastEventId;

    const reader = response.body.getReader();
    while (true) {
      let result;
      try {
        result = await reader.read();
      } catch {
        // A connection that drops mid-stream is treated like one the server closed.
        result = { done: true };
      }
      if (this.#controller !== controller) return;
      if (result.done) break;
      try {
        this.#feed(result.value);
      } catch (error) {
        // Typically a line too long to fit in a string; reported as an ErrorEvent rather than leaving the stream OPEN unread.
        if (this.#controller === controller) this.#fail(error);
        return;
      }
      if (this.#controller !== controller) return;
    }

    this.#reestablish();
  }

  #feed(chunk) {
    const text = this.#decoder.decode(chunk, { stream: true });
    const length = text.length;
    if (length === 0) return;
    let start = 0;

    if (this.#skipLF) {
      this.#skipLF = false;
      if (text.charCodeAt(0) === 0x0a) start = 1;
    }

    while (start < length) {
      let end = start;
      while (end < length) {
        const c = text.charCodeAt(end);
        if (c === 0x0a || c === 0x0d) break;
        end++;
      }
      if (end === length) {
        this.#partialLine += text.slice(start);
        return;
      }

      const line = this.#partialLine + text.slice(start, end);
      this.#partialLine = "";
      start = end + 1;
      if (text.charCodeAt(end) === 0x0d) {
        // A CR LF pair is a single line ending, even when the LF only arrives with the next chunk.
        if (start < length) {
          if (text.charCodeAt(start) === 0x0a) start++;
        } else {
          this.#skipLF = true;
        }
      }

      this.#processLine(line);
      // A listener may have called close(); the rest of the chunk must not be dispatched.
      if (this.#readyState === kClosed) return;
    }
  }

  #processLine(line) {
    if (line === "") {
      this.#dispatchBufferedEvent();
      return;
    }

    const colon = line.indexOf(":");
    if (colon === 0) return; // comment

    let field, value;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(line.charCodeAt(colon + 1) === 0x20 ? colon + 2 : colon + 1);
    }

    switch (field) {
      case "data":
        this.#dataBuffer += value + "\n";
        break;
      case "event":
        this.#eventTypeBuffer = value;
        break;
      case "id":
        if (!value.includes("\0")) this.#lastEventIdBuffer = value;
        break;
      case "retry":
        if (isASCIIDigits(value)) this.#reconnectionTime = Math.min(Number(value), kMaxReconnectionTime);
        break;
    }
  }

  #dispatchBufferedEvent() {
    // An empty line commits the id even when there is no data to dispatch.
    this.#lastEventId = this.#lastEventIdBuffer;

    const data = this.#dataBuffer;
    const type = this.#eventTypeBuffer;
    this.#dataBuffer = "";
    this.#eventTypeBuffer = "";
    if (data === "") return;

    super.dispatchEvent(
      new MessageEvent(type === "" ? "message" : type, {
        // Every `data:` line appended a LF; the last one is not part of the payload.
        data: data.slice(0, -1),
        origin: this.#origin,
        lastEventId: this.#lastEventId,
      }),
    );
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#fail-the-connection
  #fail(error) {
    this.#readyState = kClosed;
    this.#abort();
    super.dispatchEvent(
      error === undefined
        ? new Event("error")
        : new ErrorEvent("error", { error, message: `${error?.message ?? error}` }),
    );
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#reestablish-the-connection
  #reestablish() {
    this.#controller = null;
    this.#readyState = kConnecting;
    super.dispatchEvent(new Event("error"));
    // The error handler may have called close().
    if (this.#readyState !== kConnecting) return;

    // Like undici, waiting to reconnect does not by itself keep the process alive; an in-flight connection does.
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, this.#reconnectionTime).unref();
  }
}

for (const [name, value] of [
  ["CONNECTING", kConnecting],
  ["OPEN", kOpen],
  ["CLOSED", kClosed],
]) {
  // WebIDL constants live on both the interface and its prototype and are read-only.
  Object.defineProperty(EventSource, name, { enumerable: true, value });
  Object.defineProperty(EventSource.prototype, name, { enumerable: true, value });
}
for (const name of ["url", "withCredentials", "readyState", "close", "onopen", "onmessage", "onerror"]) {
  Object.defineProperty(EventSource.prototype, name, { enumerable: true });
}
Object.defineProperty(EventSource.prototype, Symbol.toStringTag, { configurable: true, value: "EventSource" });

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
