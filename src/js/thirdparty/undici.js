const EventEmitter = require("node:events");
const dc = require("node:diagnostics_channel");
const { isArrayBuffer } = require("node:util/types");
const { checkIsHttpToken } = require("internal/validators");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);
const noop = () => {};

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
const BunWebSocket = bindings[8];
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

function closeEmptyBody(controller) {
  controller.close();
}

class BodyReadable extends ReadableFromWeb {
  #response;
  #bodyUsed;
  #onFinished;

  constructor(response, onFinished) {
    // A response with no body (204, HEAD) still gets a body, as in undici:
    // https://github.com/nodejs/undici/blob/v6.21.3/lib/api/api-request.js#L118-L126
    super({ responseBody: true }, response.body ?? new ReadableStream({ start: closeEmptyBody }));

    this.#response = response;
    this.#bodyUsed = response.bodyUsed;
    this.#onFinished = onFinished;
    this.on("close", onFinished);
  }

  get bodyUsed() {
    // return this.#response.bodyUsed;
    return this.#bodyUsed;
  }

  async #consume(method) {
    if (this.#bodyUsed) throw new TypeError("unusable");
    this.#bodyUsed = true;
    try {
      return await this.#response[method]();
    } finally {
      this.#onFinished();
    }
  }

  arrayBuffer() {
    return this.#consume("arrayBuffer");
  }

  blob() {
    return this.#consume("blob");
  }

  formData() {
    return this.#consume("formData");
  }

  json() {
    return this.#consume("json");
  }

  text() {
    return this.#consume("text");
  }

  bytes() {
    return this.#consume("bytes");
  }

  // https://github.com/nodejs/undici/blob/v6.21.3/lib/api/readable.js#L158-L199
  async dump(opts) {
    const signal = opts?.signal;
    if (signal != null && (typeof signal !== "object" || !("aborted" in signal))) {
      throw new InvalidArgumentError("signal must be an AbortSignal");
    }
    const limit = Number.isFinite(opts?.limit) ? opts.limit : 128 * 1024;
    signal?.throwIfAborted();
    this.#bodyUsed = true;
    if (this._readableState.closeEmitted) return null;

    return await new Promise((resolve, reject) => {
      if (Number(this.#response.headers.get("content-length")) > limit) this.destroy(new AbortError());

      const onAbort = () => this.destroy(signal.reason ?? new AbortError());
      signal?.addEventListener("abort", onAbort);

      let bytesRead = 0;
      this.on("close", () => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) reject(signal.reason ?? new AbortError());
        else resolve(null);
      })
        .on("error", noop)
        .on("data", chunk => {
          bytesRead += chunk.length;
          if (bytesRead >= limit) this.destroy();
        })
        .resume();
    });
  }
}

// https://github.com/nodejs/undici/blob/v6.21.3/lib/core/util.js#L134-L203
function parseURL(url) {
  if (typeof url === "string" || url instanceof URL) return new URL(url);
  if (!url || typeof url !== "object") throw new TypeError("url must be a string, URL, or UrlObject");
  const port = url.port != null ? url.port : url.protocol === "https:" ? 443 : 80;
  let origin = url.origin != null ? String(url.origin) : `${url.protocol || ""}//${url.hostname || ""}:${port}`;
  let path = url.path != null ? url.path : `${url.pathname || ""}${url.search || ""}`;
  if (origin[origin.length - 1] === "/") origin = origin.slice(0, -1);
  if (path && path[0] !== "/") path = `/${path}`;
  // new URL(path, origin) would let an absolute URL in `path` replace the origin.
  return new URL(`${origin}${path}`);
}

function parseOrigin(origin) {
  if (!origin || (typeof origin !== "string" && typeof origin !== "object")) {
    throw new InvalidArgumentError("Invalid URL: The URL argument must be a non-null object.");
  }
  const url = parseURL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidArgumentError("Invalid URL protocol: the URL must start with `http:` or `https:`.");
  }
  if (url.pathname !== "/" || url.search || url.hash) throw new InvalidArgumentError("invalid url");
  return url.origin;
}

// https://github.com/nodejs/undici/blob/v6.21.3/lib/core/request.js#L159-L182
function toHeaders(input) {
  const headers = new Headers();
  if (input == null) return headers;
  if (typeof input !== "object") throw new InvalidArgumentError("headers must be an object or an array");
  const append = (name, value) => {
    if ($isJSArray(value)) for (let i = 0; i < value.length; i++) headers.append(name, value[i]);
    else if (value !== undefined) headers.append(name, value === null ? "" : value);
  };
  // An array of [name, value] pairs, which fetch() takes, is read by the iterable branch.
  if ($isJSArray(input) && !$isJSArray(input[0])) {
    if (input.length % 2 !== 0) throw new InvalidArgumentError("headers array must be even");
    for (let i = 0; i < input.length; i += 2) append(input[i], input[i + 1]);
  } else if (input[Symbol.iterator]) {
    for (const { 0: name, 1: value } of input) append(name, value);
  } else {
    for (const name of Object.keys(input)) append(name, input[name]);
  }
  return headers;
}

// Aborts `controller` on the signal's "abort" event, like undici. Returns the function that removes the listener.
function addAbortListener(signal, controller) {
  if (!signal) return noop;
  const onAbort = () => controller.abort(signal.reason ?? new RequestAbortedError());
  if (signal.aborted) {
    onAbort();
    return noop;
  }
  if ("addEventListener" in signal) {
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }
  signal.once("abort", onAbort);
  return () => signal.removeListener("abort", onAbort);
}

// Removes a body's abort listener when the body is dropped unread. The signal can outlive it.
let droppedBodies;

function callFunction(fn) {
  fn();
}

// fetch() already decoded the body, so Content-Encoding and the encoded Content-Length no longer describe it.
function responseHeaders(response, method) {
  const headers = response.headers.toJSON();
  if (method !== "HEAD" && headers["content-encoding"]) {
    delete headers["content-encoding"];
    delete headers["content-length"];
  }
  return headers;
}

function validateRequest({ method, body, maxRedirections, signal }) {
  // https://github.com/nodejs/undici/blob/v6.21.3/lib/core/request.js#L59-L63
  if (!method) method = "GET";
  else if (typeof method !== "string") throw new InvalidArgumentError("method must be a string");
  else if (!checkIsHttpToken(method)) throw new InvalidArgumentError("invalid request method");
  method = method.toUpperCase();
  if (method === "CONNECT") throw new InvalidArgumentError("invalid method");

  if (body && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  if (maxRedirections != null && (!Number.isInteger(maxRedirections) || maxRedirections < 0)) {
    throw new Error("maxRedirections must be a positive number");
  }

  if (signal && !$isCallable(signal.on) && !$isCallable(signal.addEventListener)) {
    throw new InvalidArgumentError("signal must be an EventEmitter or EventTarget");
  }
  return method;
}

// Sends a request() or dispatch() request with native fetch().
function send(dispatcher, url, method, { headers, body, maxRedirections, reset }, signal) {
  const followRedirects = maxRedirections > 0;
  return nativeFetch(url, {
    ...dispatcher?.[kFetchOptions],
    signal,
    method,
    headers: toHeaders(headers),
    body,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !reset,
  });
}

function callbackify(run, callback, opaque) {
  if (callback === undefined) return run();
  if (!$isCallable(callback)) throw new InvalidArgumentError("invalid callback");
  run().then(
    data => callback(null, data),
    err => callback(err, { opaque }),
  );
}

// NOT IMPLEMENTED
// *   idempotent?: boolean;
// *   onInfo?: (info: { statusCode: number, headers: Object<string, string | string[]> }) => void;
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
 *   opaque?: *;
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
async function request(url, options = kEmptyObject) {
  const { query, signal, throwOnError, opaque = kEmptyObject, dispatcher = globalDispatcher } = options;

  url = parseURL(url);
  if (query) url.search = new URLSearchParams(query).toString();
  const method = validateRequest(options);

  const controller = new AbortController();
  const removeAbortListener = addAbortListener(signal, controller);
  try {
    const run = signal =>
      hasOwnDispatch(dispatcher)
        ? sendWithDispatch(dispatcher, url, { ...options, method, query: undefined }, signal)
        : send(dispatcher, url, method, options, signal);
    /** @type {Response} */
    const resp = await (dispatcher?.[kTrack] ? dispatcher[kTrack](controller.signal, run) : run(controller.signal));
    const statusCode = resp.status;

    // Throw if received 4xx or 5xx response indicating HTTP error
    if (throwOnError && statusCode >= 400 && statusCode < 600) {
      throw new Error(`Request failed with status code ${statusCode}`);
    }

    const body = new BodyReadable(resp, removeAbortListener);
    if (signal) (droppedBodies ??= new FinalizationRegistry(callFunction)).register(body, removeAbortListener);
    return { statusCode, headers: responseHeaders(resp, method), body, trailers: {}, opaque, context: kEmptyObject };
  } catch (err) {
    removeAbortListener();
    throw err;
  }
}

// https://github.com/nodejs/undici/blob/v6.21.3/lib/api/api-stream.js
async function stream(url, options, factory) {
  if ($isCallable(options)) {
    factory = options;
    options = undefined;
  }
  if (!$isCallable(factory)) throw new InvalidArgumentError("invalid factory");
  const { statusCode, headers, body, opaque, context } = await request(url, options);
  try {
    const writable = factory({ statusCode, headers, opaque, context });
    if (!writable || !$isCallable(writable.write) || !$isCallable(writable.end) || !$isCallable(writable.on)) {
      throw new InvalidReturnValueError("expected Writable");
    }
    await require("node:stream/promises").pipeline(body, writable);
  } catch (err) {
    body.destroy();
    throw err;
  }
  return { opaque, trailers: {} };
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

const kFetchOptions = Symbol("kFetchOptions");
const kTrack = Symbol("kTrack");
const kUsesFetch = Symbol("kUsesFetch");

class Dispatcher extends EventEmitter {
  dispatch() {
    throw new Error("not implemented");
  }

  close() {
    throw new Error("not implemented");
  }

  destroy() {
    throw new Error("not implemented");
  }
}

// Maps a dispatcher's `connect` options, which undici passes to tls.connect(), to native fetch() options.
function connectToFetchOptions(connect, socketPath) {
  // A connector function has no options. Its own properties must not relax TLS while the function itself is ignored.
  if ($isCallable(connect)) connect = undefined;
  socketPath ??= connect?.socketPath;
  const tls = connect && require("internal/tls").nodeClientTlsToNative({ __proto__: null, ...connect });
  if (!tls && !socketPath) return undefined;
  return { __proto__: null, tls, unix: socketPath };
}

// https://github.com/nodejs/undici/blob/v7.16.0/lib/handler/unwrap-handler.js
function unwrapHandler(handler) {
  if (!handler.onRequestStart) return handler;
  let paused = false;
  let aborted = false;
  let reason = null;
  let abortRequest;
  let resumeBody;
  const controller = {
    pause() {
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      resumeBody?.();
    },
    abort(err) {
      if (aborted) return;
      aborted = true;
      reason = err;
      abortRequest(err);
    },
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    get paused() {
      return paused;
    },
  };
  return {
    onConnect(abort, context) {
      abortRequest = abort;
      handler.onRequestStart(controller, context);
    },
    onHeaders(statusCode, rawHeaders, resume, statusText) {
      resumeBody = resume;
      handler.onResponseStart?.(controller, statusCode, parseRawHeaders(rawHeaders), statusText);
      return !paused;
    },
    onData(chunk) {
      handler.onResponseData?.(controller, chunk);
      return !paused;
    },
    onComplete(rawTrailers) {
      handler.onResponseEnd?.(controller, parseRawHeaders(rawTrailers));
    },
    onError(err) {
      if (!handler.onResponseError) throw new InvalidArgumentError("invalid onError method");
      handler.onResponseError(controller, err);
    },
  };
}

function parseRawHeaders(rawHeaders) {
  const headers = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toString().toLowerCase();
    const value = rawHeaders[i + 1].toString();
    const existing = headers[name];
    if (existing === undefined) headers[name] = value;
    else if ($isJSArray(existing)) existing.push(value);
    else headers[name] = [existing, value];
  }
  return headers;
}

// Runs one native fetch() and reports it through a dispatch() handler's callbacks.
async function dispatchWithFetch(dispatcher, url, method, opts, handler, controller, signal) {
  let paused = false;
  let wake = noop;
  const resume = () => {
    paused = false;
    wake();
  };
  signal.addEventListener("abort", resume, { once: true });

  handler.onConnect?.(reason => controller.abort(reason ?? new RequestAbortedError()), null);
  signal.throwIfAborted();

  const response = await send(dispatcher, url, method, opts, signal);

  const headers = responseHeaders(response, method);
  const rawHeaders = [];
  for (const name of Object.keys(headers)) {
    const value = headers[name];
    for (const line of $isJSArray(value) ? value : [value]) rawHeaders.push(Buffer.from(name), Buffer.from(line));
  }
  paused = handler.onHeaders?.(response.status, rawHeaders, resume, response.statusText) === false;

  const whileNotPaused = async () => {
    while (paused && !signal.aborted) await new Promise(resolve => (wake = resolve));
    signal.throwIfAborted();
  };
  const { body } = response;
  if (body) {
    for await (const chunk of body) {
      await whileNotPaused();
      paused = handler.onData?.(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)) === false;
    }
  }
  await whileNotPaused();
  handler.onComplete?.([]);
}

// https://github.com/nodejs/undici/blob/v6.21.3/lib/dispatcher/dispatcher-base.js
class DispatcherBase extends Dispatcher {
  #origin;
  #hasConnector;
  #closed = false;
  #destroyed = false;
  #aborter = new AbortController();
  #pending = 0;
  #onDrain = [];

  constructor(options, origin) {
    super();
    this.#origin = origin;
    this.#hasConnector = $isCallable(options?.connect);
    this[kFetchOptions] = connectToFetchOptions(options?.connect, options?.socketPath);
  }

  get closed() {
    return this.#closed;
  }

  get destroyed() {
    return this.#destroyed;
  }

  // Returns false if a subclass overrides dispatch(). fetch() then has to call it.
  get [kUsesFetch]() {
    return this.dispatch === DispatcherBase.prototype.dispatch;
  }

  #url(opts) {
    if (!opts || typeof opts !== "object") throw new InvalidArgumentError("invalid opts");
    // The connector may be what verifies the server, so don't connect without it.
    if (this.#hasConnector) throw new NotSupportedError("A `connect` function is not yet implemented in Bun");
    const { origin, path } = opts;
    if (this.#origin === undefined && (!origin || (typeof origin !== "string" && !(origin instanceof URL)))) {
      throw new InvalidArgumentError("opts.origin must be a non-empty string or URL.");
    }
    if (typeof path !== "string") throw new InvalidArgumentError("path must be a string");
    if (path[0] !== "/") throw new InvalidArgumentError("path must be an absolute URL or start with a slash");
    // new URL(path, origin) would let a path like "//host/" replace the origin.
    return new URL((this.#origin ?? parseOrigin(origin)) + path);
  }

  #assertOpen() {
    if (this.#destroyed) throw new ClientDestroyedError();
    if (this.#closed) throw new ClientClosedError();
  }

  // Runs one request with a signal that destroy() aborts too, even after `run` settled. close() waits for `run`.
  async [kTrack](signal, run) {
    this.#assertOpen();
    this.#pending++;
    try {
      return await run(AbortSignal.any([signal, this.#aborter.signal]));
    } finally {
      if (--this.#pending === 0) for (const callback of this.#onDrain.splice(0)) callback();
    }
  }

  #whenDrained(callback) {
    if (this.#pending === 0) queueMicrotask(callback);
    else this.#onDrain.push(callback);
  }

  close(callback) {
    if (callback === undefined) {
      return new Promise((resolve, reject) => this.close((err, data) => (err ? reject(err) : resolve(data))));
    }
    if (!$isCallable(callback)) throw new InvalidArgumentError("invalid callback");
    if (this.#destroyed) {
      queueMicrotask(() => callback(new ClientDestroyedError(), null));
      return;
    }
    this.#closed = true;
    this.#whenDrained(() => {
      this.#destroyed = true;
      callback(null, null);
    });
  }

  destroy(err, callback) {
    if ($isCallable(err)) {
      callback = err;
      err = null;
    }
    if (callback === undefined) {
      return new Promise((resolve, reject) => this.destroy(err, (err, data) => (err ? reject(err) : resolve(data))));
    }
    if (!$isCallable(callback)) throw new InvalidArgumentError("invalid callback");
    this.#destroyed = true;
    this.#aborter.abort(err || new ClientDestroyedError());
    this.#whenDrained(() => callback(null, null));
  }

  dispatch(opts, handler) {
    if (!handler || typeof handler !== "object") throw new InvalidArgumentError("handler must be an object");
    handler = unwrapHandler(handler);
    let url, method;
    try {
      if (!opts || typeof opts !== "object") throw new InvalidArgumentError("opts must be an object.");
      this.#assertOpen();
      url = this.#url(opts);
      const { query } = opts;
      if (query) url.search = new URLSearchParams(query).toString();
      method = validateRequest(opts);
    } catch (err) {
      if (!$isCallable(handler.onError)) throw err;
      handler.onError(err);
      return false;
    }
    const controller = new AbortController();
    this[kTrack](controller.signal, async signal => {
      try {
        await dispatchWithFetch(this, url, method, opts, handler, controller, signal);
      } catch (err) {
        controller.abort(err);
        handler.onError(err);
      }
    });
    return true;
  }

  request(opts, callback) {
    return callbackify(async () => request(this.#url(opts), { ...opts, dispatcher: this }), callback, opts?.opaque);
  }

  stream(opts, factory, callback) {
    return callbackify(
      async () => stream(this.#url(opts), { ...opts, dispatcher: this }, factory),
      callback,
      opts?.opaque,
    );
  }
}

class Agent extends DispatcherBase {
  constructor(options) {
    super(options);
  }
}

class Client extends DispatcherBase {
  constructor(origin, options) {
    super(options, parseOrigin(origin));
  }
}

class Pool extends DispatcherBase {
  constructor(origin, options) {
    super(options, parseOrigin(origin));
  }
}

class BalancedPool extends Dispatcher {}

// https://github.com/nodejs/undici/blob/v6.21.3/lib/dispatcher/proxy-agent.js#L28-L61
class ProxyAgent extends DispatcherBase {
  constructor(opts) {
    if (!opts || (typeof opts === "object" && !(opts instanceof URL) && !opts.uri)) {
      throw new InvalidArgumentError("Proxy uri is mandatory");
    }
    super();
    const url = new URL(typeof opts === "string" || opts instanceof URL ? opts : opts.uri).href;
    const { auth, token } = opts;
    const headers = { ...opts.headers };
    if (auth && token) {
      throw new InvalidArgumentError("opts.auth cannot be used in combination with opts.token");
    } else if (auth) {
      headers["proxy-authorization"] = `Basic ${auth}`;
    } else if (token) {
      headers["proxy-authorization"] = token;
    }
    // fetch()'s `tls` also covers the connection to an https: proxy, which requestTls must not relax.
    const requestTls = url.startsWith("https:") ? undefined : connectToFetchOptions(opts.requestTls);
    this[kFetchOptions] = { __proto__: null, ...requestTls, proxy: { url, headers } };
  }
}

// Native fetch() reads the *_PROXY environment variables itself, on every redirect hop.
class EnvHttpProxyAgent extends DispatcherBase {
  constructor(options) {
    super(options);
  }
}

class RetryAgent extends Dispatcher {
  #agent;

  constructor(agent) {
    super();
    this.#agent = agent;
  }

  get [kFetchOptions]() {
    return this.#agent?.[kFetchOptions];
  }

  get [kUsesFetch]() {
    return this.dispatch === RetryAgent.prototype.dispatch && this.#agent?.[kUsesFetch] === true;
  }

  dispatch(opts, handler) {
    return this.#agent.dispatch(opts, handler);
  }

  request(opts, callback) {
    return this.#agent.request(opts, callback);
  }

  close(callback) {
    return this.#agent.close(callback);
  }

  destroy(err, callback) {
    return this.#agent.destroy(err, callback);
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

// https://github.com/nodejs/undici/blob/v6.21.3/lib/core/errors.js
class UndiciError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UndiciError";
    this.code = "UND_ERR";
  }
}

function defineError(className, code, defaultMessage, name = className, Base = UndiciError) {
  const ErrorClass = class extends Base {
    constructor(message) {
      super(message || defaultMessage);
      this.name = name;
      this.code = code;
    }
  };
  Object.defineProperty(ErrorClass, "name", { value: className });
  return ErrorClass;
}

const AbortError = defineError("AbortError", "UND_ERR_ABORT", "The operation was aborted");
const HeadersTimeoutError = defineError("HeadersTimeoutError", "UND_ERR_HEADERS_TIMEOUT", "Headers Timeout Error");
const HeadersOverflowError = defineError("HeadersOverflowError", "UND_ERR_HEADERS_OVERFLOW", "Headers Overflow Error");
const BodyTimeoutError = defineError("BodyTimeoutError", "UND_ERR_BODY_TIMEOUT", "Body Timeout Error");
const RequestContentLengthMismatchError = defineError(
  "RequestContentLengthMismatchError",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "Request body length does not match content-length header",
);
const ConnectTimeoutError = defineError("ConnectTimeoutError", "UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error");
const InvalidArgumentError = defineError("InvalidArgumentError", "UND_ERR_INVALID_ARG", "Invalid Argument Error");
const InvalidReturnValueError = defineError(
  "InvalidReturnValueError",
  "UND_ERR_INVALID_RETURN_VALUE",
  "Invalid Return Value Error",
);
const RequestAbortedError = defineError(
  "RequestAbortedError",
  "UND_ERR_ABORTED",
  "Request aborted",
  "AbortError",
  AbortError,
);
const ClientDestroyedError = defineError("ClientDestroyedError", "UND_ERR_DESTROYED", "The client is destroyed");
const ClientClosedError = defineError("ClientClosedError", "UND_ERR_CLOSED", "The client is closed");
const InformationalError = defineError("InformationalError", "UND_ERR_INFO", "Request information");
const NotSupportedError = defineError("NotSupportedError", "UND_ERR_NOT_SUPPORTED", "Not supported error");
const ResponseContentLengthMismatchError = defineError(
  "ResponseContentLengthMismatchError",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "Response body length does not match content-length header",
);
const BalancedPoolMissingUpstreamError = defineError(
  "BalancedPoolMissingUpstreamError",
  "UND_ERR_BPL_MISSING_UPSTREAM",
  "No upstream has been added to the BalancedPool",
  "MissingUpstreamError",
);
const ResponseExceededMaxSizeError = defineError(
  "ResponseExceededMaxSizeError",
  "UND_ERR_RES_EXCEEDED_MAX_SIZE",
  "Response content exceeded max size",
);

class HTTPParserError extends Error {
  constructor(message, code, data) {
    super(message);
    this.name = "HTTPParserError";
    this.code = code ? `HPE_${code}` : undefined;
    this.data = data ? data.toString() : undefined;
  }
}

class ResponseStatusCodeError extends UndiciError {
  constructor(message, statusCode, headers, body) {
    super(message || "Response Status Code Error");
    this.name = "ResponseStatusCodeError";
    this.code = "UND_ERR_RESPONSE_STATUS_CODE";
    this.body = body;
    this.status = statusCode;
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

class SocketError extends UndiciError {
  constructor(message, socket) {
    super(message || "Socket error");
    this.name = "SocketError";
    this.code = "UND_ERR_SOCKET";
    this.socket = socket;
  }
}

class RequestRetryError extends UndiciError {
  constructor(message, code, { headers, data } = kEmptyObject) {
    super(message || "Request retry error");
    this.name = "RequestRetryError";
    this.code = "UND_ERR_REQ_RETRY";
    this.statusCode = code;
    this.data = data;
    this.headers = headers;
  }
}

class SecureProxyConnectionError extends UndiciError {
  constructor(cause, message, options) {
    super(message || "Secure Proxy Connection failed", { cause, ...options });
    this.name = "SecureProxyConnectionError";
    this.code = "UND_ERR_PRX_TLS";
  }
}

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

const pingChannel = dc.channel("undici:websocket:ping");
const pongChannel = dc.channel("undici:websocket:pong");

function toBuffer(data) {
  if ($isTypedArrayView(data)) return data;
  // A received frame's Blob is in memory, so arrayBuffer() returns an already-fulfilled promise.
  return Buffer.from(isArrayBuffer(data) ? data : $peekPromiseSettledValue(data.arrayBuffer()));
}

function onPing(event) {
  if (pingChannel.hasSubscribers) pingChannel.publish({ payload: toBuffer(event.data), websocket: event.target });
}

function onPong(event) {
  if (pongChannel.hasSubscribers) pongChannel.publish({ payload: toBuffer(event.data), websocket: event.target });
}

class WebSocket extends BunWebSocket {
  constructor(url, protocols) {
    super(url, protocols);
    this.addEventListener("ping", onPing);
    this.addEventListener("pong", onPong);
  }
}

function ping(ws, body) {
  if (Buffer.isBuffer(body)) {
    if (body.length > 125) throw new TypeError("A PING frame cannot have a body larger than 125 bytes.");
  } else if (body !== undefined) {
    throw new TypeError("Expected buffer payload");
  }
  if (!(ws instanceof BunWebSocket)) throw new TypeError("Expected a WebSocket");
  if (ws.readyState === BunWebSocket.OPEN) ws.ping(body);
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
  return (globalDispatcher ??= new Agent());
}

const nullBodyStatus = [101, 204, 205, 304];
const redirectStatus = [301, 302, 303, 307, 308];

// Returns true if `dispatcher` has its own dispatch(), which requests then have to go through.
function hasOwnDispatch(dispatcher) {
  if (dispatcher == null || dispatcher[kUsesFetch]) return false;
  const { dispatch } = dispatcher;
  // BalancedPool only inherits the abstract dispatch(), which throws.
  return $isCallable(dispatch) && dispatch !== Dispatcher.prototype.dispatch;
}

// Calls dispatcher.dispatch() and builds the Response from the handler callbacks.
function sendWithDispatch(dispatcher, url, options, signal, redirect) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const { method } = options;
    let abort = noop;
    let body;
    const onAbort = () => abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });

    dispatcher.dispatch(
      { ...options, origin: url.origin, path: url.pathname + url.search },
      {
        onConnect(abortRequest) {
          abort = abortRequest;
          if (signal.aborted) onAbort();
        },
        onHeaders(status, rawHeaders, resume, statusText) {
          if (status < 200) return true;
          if (redirect === "error" && redirectStatus.includes(status)) {
            abort(new TypeError("unexpected redirect"));
            return true;
          }
          const headers = new Headers();
          for (let i = 0; i < rawHeaders.length; i += 2) headers.append(`${rawHeaders[i]}`, `${rawHeaders[i + 1]}`);
          const stream =
            method === "HEAD" || nullBodyStatus.includes(status)
              ? null
              : new ReadableStream({
                  start(controller) {
                    body = controller;
                  },
                  pull: resume,
                  cancel(reason) {
                    body = undefined;
                    abort(reason);
                  },
                });
          const response = new Response(stream, { status, statusText, headers });
          Object.defineProperty(response, "url", { value: url.href });
          resolve(response);
          return true;
        },
        onData(chunk) {
          if (!body) return true;
          body.enqueue(chunk);
          return body.desiredSize > 0;
        },
        onComplete() {
          signal.removeEventListener("abort", onAbort);
          body?.close();
        },
        onError(err) {
          signal.removeEventListener("abort", onAbort);
          body?.error(err);
          reject(err);
        },
      },
    );
  });
}

async function fetchWithDispatch(dispatcher, input, init) {
  const { url, method, headers, body, redirect, signal } = new Request(input, init);
  const maxRedirections = redirect === "follow" ? 20 : 0;
  const options = { method, headers: headers.toJSON(), body, maxRedirections };
  return await sendWithDispatch(dispatcher, new URL(url), options, signal, redirect);
}

function fetch(input, init) {
  const dispatcher = init?.dispatcher ?? globalDispatcher;
  if (hasOwnDispatch(dispatcher)) return fetchWithDispatch(dispatcher, input, init);
  const options = dispatcher?.[kFetchOptions];
  if (!options) return nativeFetch(input, init);
  if (init instanceof Request) {
    // A Request's fields are getters, so a spread would lose them.
    try {
      return nativeFetch(new Request(input, init), options);
    } catch (err) {
      return Promise.$reject(err);
    }
  }
  const merged = { ...init };
  for (const name in options) merged[name] ??= options[name];
  return nativeFetch(input, merged);
}
fetch.preconnect = nativeFetch.preconnect;

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
  return function connect(_options) {
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
