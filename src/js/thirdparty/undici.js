const EventEmitter = require("node:events");
const StreamModule = require("node:stream");
const { Readable } = StreamModule;
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

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

  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    // TODO: Streaming via ReadableStream?
    let data = "";
    inputBody.setEncoding("utf8");
    for await (const chunk of stream) {
      data += chunk;
    }
    inputBody = new TextEncoder().encode(data);
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
  const {
    status: statusCode,
    headers,
    trailers,
  } = (resp = await fetch(url, {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: maxRedirections === "undefined" || maxRedirections > 0 ? "follow" : "manual",
    keepalive: !reset,
  }));

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

// EventSource (Server-Sent Events) implementation
// Follows the WHATWG HTML spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
class EventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  #url;
  #withCredentials;
  #readyState = 0;
  #lastEventId = "";
  #reconnectionTime = 3000;
  #abortController = null;
  #reconnectTimer = null;

  #onopen = null;
  #onmessage = null;
  #onerror = null;

  constructor(url, options) {
    super();

    // Validate and resolve URL
    const resolvedUrl = new URL(url, typeof location !== "undefined" ? location.href : undefined);

    this.#url = resolvedUrl.href;
    this.#withCredentials = options?.withCredentials ?? false;
    this.#readyState = EventSource.CONNECTING;

    // Start connection on next tick
    process.nextTick(() => this.#connect());
  }

  // Instance getters that delegate to static constants (not writable/enumerable own properties)
  get CONNECTING() {
    return EventSource.CONNECTING;
  }

  get OPEN() {
    return EventSource.OPEN;
  }

  get CLOSED() {
    return EventSource.CLOSED;
  }

  get url() {
    return this.#url;
  }

  get readyState() {
    return this.#readyState;
  }

  get withCredentials() {
    return this.#withCredentials;
  }

  get onopen() {
    return this.#onopen;
  }

  set onopen(value) {
    const oldHandler = this.#onopen;
    // Only store functions, treat non-callables as null
    const newHandler = typeof value === "function" ? value : null;
    this.#onopen = newHandler;
    // Remove old handler if it was a function
    if (typeof oldHandler === "function") {
      this.removeEventListener("open", oldHandler);
    }
    // Add new handler if it's a function
    if (typeof newHandler === "function") {
      this.addEventListener("open", newHandler);
    }
  }

  get onmessage() {
    return this.#onmessage;
  }

  set onmessage(value) {
    const oldHandler = this.#onmessage;
    // Only store functions, treat non-callables as null
    const newHandler = typeof value === "function" ? value : null;
    this.#onmessage = newHandler;
    // Remove old handler if it was a function
    if (typeof oldHandler === "function") {
      this.removeEventListener("message", oldHandler);
    }
    // Add new handler if it's a function
    if (typeof newHandler === "function") {
      this.addEventListener("message", newHandler);
    }
  }

  get onerror() {
    return this.#onerror;
  }

  set onerror(value) {
    const oldHandler = this.#onerror;
    // Only store functions, treat non-callables as null
    const newHandler = typeof value === "function" ? value : null;
    this.#onerror = newHandler;
    // Remove old handler if it was a function
    if (typeof oldHandler === "function") {
      this.removeEventListener("error", oldHandler);
    }
    // Add new handler if it's a function
    if (typeof newHandler === "function") {
      this.addEventListener("error", newHandler);
    }
  }

  close() {
    this.#readyState = EventSource.CLOSED;

    if (this.#abortController) {
      this.#abortController.abort();
      this.#abortController = null;
    }

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #connect() {
    if (this.#readyState === EventSource.CLOSED) {
      return;
    }

    const abortController = new AbortController();
    this.#abortController = abortController;

    const headers = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };

    if (this.#lastEventId) {
      headers["Last-Event-ID"] = this.#lastEventId;
    }

    fetch(this.#url, {
      method: "GET",
      headers,
      credentials: this.#withCredentials ? "include" : "same-origin",
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(response => {
        if (this.#readyState === EventSource.CLOSED) {
          return;
        }

        // HTTP 204 No Content means server wants to close the connection permanently
        if (response.status === 204) {
          this.#fail();
          return;
        }

        if (!response.ok) {
          this.#fail();
          return;
        }

        const contentType = response.headers.get("Content-Type");
        // Parse MIME type: extract media type before any parameters, case-insensitive comparison
        const mimeType = contentType ? contentType.split(";")[0].trim().toLowerCase() : "";
        if (mimeType !== "text/event-stream") {
          this.#fail();
          return;
        }

        this.#readyState = EventSource.OPEN;
        this.dispatchEvent(new Event("open"));

        if (!response.body) {
          this.#reconnect();
          return;
        }

        this.#readStream(response.body);
      })
      .catch(error => {
        if (this.#readyState === EventSource.CLOSED) {
          return;
        }

        if (error.name === "AbortError") {
          return;
        }

        this.#reconnect();
      });
  }

  async #readStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let eventType = "";
    let data = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (this.#readyState === EventSource.CLOSED) {
          reader.cancel();
          return;
        }

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let lineEnd;
        while ((lineEnd = this.#findLineEnd(buffer)) !== -1) {
          const char = buffer[lineEnd];
          const line = buffer.slice(0, lineEnd);
          // Handle CRLF: if we see \r, check if next char is \n
          // If \r is at end of buffer, wait for more data to check for \n
          if (char === "\r") {
            if (lineEnd + 1 >= buffer.length) {
              // \r at end of buffer - need more data to know if CRLF
              break;
            }
            buffer = buffer.slice(lineEnd + (buffer[lineEnd + 1] === "\n" ? 2 : 1));
          } else {
            buffer = buffer.slice(lineEnd + 1);
          }

          if (line === "") {
            if (data.length > 0) {
              const origin = new URL(this.#url).origin;

              const event = new MessageEvent(eventType || "message", {
                data: data.join("\n"),
                origin: origin,
                lastEventId: this.#lastEventId,
              });

              this.dispatchEvent(event);
            }

            eventType = "";
            data = [];
          } else if (line[0] === ":") {
            // Comment line, ignore
          } else {
            const colonIndex = line.indexOf(":");
            let field;
            let fieldValue;

            if (colonIndex === -1) {
              field = line;
              fieldValue = "";
            } else {
              field = line.slice(0, colonIndex);
              fieldValue = line.slice(colonIndex + 1);
              if (fieldValue[0] === " ") {
                fieldValue = fieldValue.slice(1);
              }
            }

            switch (field) {
              case "event":
                eventType = fieldValue;
                break;
              case "data":
                data.push(fieldValue);
                break;
              case "id":
                if (!fieldValue.includes("\0")) {
                  this.#lastEventId = fieldValue;
                }
                break;
              case "retry":
                if (/^\d+$/.test(fieldValue)) {
                  this.#reconnectionTime = parseInt(fieldValue, 10);
                }
                break;
            }
          }
        }
      }
    } catch (error) {
      if (this.#readyState === EventSource.CLOSED) {
        return;
      }

      if (error.name === "AbortError") {
        return;
      }

      this.#reconnect();
      return;
    }

    this.#reconnect();
  }

  #findLineEnd(buffer) {
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === "\n" || buffer[i] === "\r") {
        return i;
      }
    }
    return -1;
  }

  #fail() {
    this.#readyState = EventSource.CLOSED;

    if (this.#abortController) {
      this.#abortController.abort();
      this.#abortController = null;
    }

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }

    // Per spec, error events are simple Event objects, not ErrorEvent
    this.dispatchEvent(new Event("error"));
  }

  #reconnect() {
    if (this.#readyState === EventSource.CLOSED) {
      return;
    }

    this.#readyState = EventSource.CONNECTING;

    // Per spec, error events are simple Event objects, not ErrorEvent
    this.dispatchEvent(new Event("error"));

    // Clear any existing timer before scheduling a new one
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
    }
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, this.#reconnectionTime);
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
