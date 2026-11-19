const EventEmitter = require("node:events");
const dc = require("node:diagnostics_channel");
const { isArrayBuffer } = require("node:util/types");
const { Readable, Transform, pipeline: pipelineStreams } = require("node:stream");
const { Buffer } = require("node:buffer");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");
const { isDisturbed } = require("internal/streams/utils");

const ObjectCreate = Object.create;
const ObjectPrototypeToString = Object.prototype.toString;
const SafeFinalizationRegistry = FinalizationRegistry;
const SafeWeakRef = WeakRef;
const kEmptyObject = Object.freeze(ObjectCreate(null));

// The loose overload keeps request()'s extra init fields accepted; the intersection keeps preconnect typed.
const nativeFetch: typeof Bun.fetch & ((input: string | URL | Request, init?: object) => Promise<Response>) = Bun.fetch;
const bindings = $cpp("Undici.cpp", "createUndiciInternalBinding");
const Response: typeof globalThis.Response = bindings[0];
const Request: typeof globalThis.Request = bindings[1];
const Headers: typeof globalThis.Headers = bindings[2];
const FormData = bindings[3];
const File = bindings[4];
const URL: typeof globalThis.URL = bindings[5];
const AbortSignal: typeof globalThis.AbortSignal = bindings[6];
const URLSearchParams: typeof globalThis.URLSearchParams = bindings[7];
const BunWebSocket: typeof globalThis.WebSocket = bindings[8];
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
    return this.#bodyUsed || isDisturbed(this);
  }

  #consume() {
    if (this.#bodyUsed || isDisturbed(this)) throw new TypeError("unusable");
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
    dispatcher,
  } = options as typeof options & { dispatcher?: any };

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
  if (typeof url === "object" && url !== null && query) url.search = searchFromQuery(query);

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

  const routed = dispatcher ?? globalDispatcher;
  const routeOnly = routed != null && isRouteOnly(routed);
  if (routed != null && !routeOnly && typeof routed.dispatch === "function") {
    const target = typeof url === "string" ? new URL(url) : url;
    const result: any = await Dispatcher.prototype.request.$call(routed, {
      ...options,
      origin: target.origin,
      path: target.pathname + target.search,
      method: method ?? "GET",
      query: undefined,
      // This function has its own error for the option, below.
      throwOnError: false,
    });
    const { statusCode } = result;
    if (throwOnError && statusCode >= 400 && statusCode < 600) {
      result.body.destroy();
      throw new Error(`Request failed with status code ${statusCode}`);
    }
    return result;
  }

  const nativeInit = {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !reset,
  };
  // Through the agent, so that a closed one rejects, close() waits for the headers, and destroy() aborts.
  const resp: Response & { trailers?: undefined } = await (routeOnly
    ? routed[kFetch](url, nativeInit)
    : nativeFetch(url, nativeInit));

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

function mockErrors() {}

let querystring: typeof import("node:querystring") | undefined;

// A record goes through querystring like undici's buildURL; a string, a URLSearchParams or a list of pairs stays as this shim took it.
function searchFromQuery(query) {
  if (typeof query !== "object" || typeof query[Symbol.iterator] === "function") {
    return new URLSearchParams(query).toString();
  }
  return (querystring ??= require("node:querystring")).stringify(query);
}

function appendHeader(headers, name, value) {
  if (value === undefined || value === null) return;
  name = String(name);
  if ($isJSArray(value)) {
    for (const v of value) appendHeader(headers, name, v);
    return;
  }
  const existing = headers[name];
  if (existing === undefined) headers[name] = String(value);
  else if ($isJSArray(existing)) existing.push(String(value));
  else headers[name] = [existing, String(value)];
}

function headersFromRawHeaders(rawHeaders) {
  const headers = ObjectCreate(null);
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    appendHeader(headers, String(rawHeaders[i]).toLowerCase(), String(rawHeaders[i + 1]));
  }
  return headers;
}

function parseOrigin(origin) {
  const url = origin instanceof URL ? origin : new URL(String(origin));
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new InvalidArgumentError("Invalid URL protocol: the URL must start with `http:` or `https:`.");
  if (url.pathname !== "/" || url.search || url.hash) throw new InvalidArgumentError("invalid url");
  return url;
}

function headersFromDispatchOpts(headers) {
  if (headers == null) return undefined;
  // Entries form so fetch() appends repeated names as separate lines; a record init would String()-join array values.
  const out: [string, string][] = [];
  const push = (name, value) => {
    if (value === undefined || value === null) return;
    if ($isJSArray(value)) {
      for (const v of value) push(name, v);
      return;
    }
    out.push([String(name), String(value)]);
  };
  if ($isJSArray(headers)) {
    if (headers.length > 0 && $isJSArray(headers[0])) {
      for (const [name, value] of headers) push(name, value);
    } else {
      for (let i = 0; i + 1 < headers.length; i += 2) push(headers[i], headers[i + 1]);
    }
  } else if (typeof headers[Symbol.iterator] === "function") {
    // Headers, Map, or any entries iterable; Object.keys() sees no own properties on these.
    for (const [name, value] of headers) push(name, value);
  } else {
    for (const name of Object.keys(headers)) push(name, headers[name]);
  }
  return out;
}

async function* iterableToByteChunks(iterable) {
  for await (const chunk of iterable) {
    yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
  }
}

function bodyFromDispatchOpts(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body;
  if (body instanceof Blob || body instanceof ReadableStream) return body;
  if (body instanceof FormData || body instanceof URLSearchParams) return body;
  // Stream Readables and (async) iterables instead of buffering them.
  if (typeof body[Symbol.asyncIterator] === "function" || typeof body[Symbol.iterator] === "function") {
    return Readable.toWeb(Readable.from(iterableToByteChunks(body)));
  }
  return body;
}

function isControllerHandler(handler) {
  return typeof handler.onRequestStart === "function" || typeof handler.onResponseStart === "function";
}

// Controller handlers may omit onResponseError, like undici; legacy handlers were validated to have an error callback.
function handlerError(handler, controller, err) {
  if (isControllerHandler(handler) && typeof handler.onResponseError === "function")
    handler.onResponseError(controller, err);
  else if (typeof handler.onError === "function") handler.onError(err);
  else handler.onResponseError?.(controller, err);
}

// The rule of native fetch (src/http/lib.rs): it decodes one compressed coding, and any other coding leaves the body as it came.
function nativeFetchDecodes(contentEncoding: string) {
  let decodes = false;
  for (const part of contentEncoding.toLowerCase().split(",")) {
    const coding = part.trim();
    if (coding === "" || coding === "identity") continue;
    const known =
      coding === "gzip" || coding === "x-gzip" || coding === "deflate" || coding === "br" || coding === "zstd";
    if (decodes || !known) return false;
    decodes = true;
  }
  return decodes;
}

// One fetch()-backed request driving legacy (onHeaders/onData) or v7 controller (onResponseStart/...) handler callbacks.
function fetchDispatch(origin: URL, opts: any, handler: any, pending?: Set<PendingEntry>, nativeInit?: object) {
  const isControllerStyle = isControllerHandler(handler);

  const ac = new AbortController();
  let aborted = false;
  let abortReason;
  let paused = false;
  let resumeResolve: (() => void) | null = null;
  const resume = () => {
    paused = false;
    if (resumeResolve) {
      const r = resumeResolve;
      resumeResolve = null;
      r();
    }
  };

  const resumed = async () => {
    while (paused) {
      const parked = Promise.withResolvers<void>();
      resumeResolve = parked.resolve;
      await parked.promise;
    }
  };

  const abort = reason => {
    if (aborted) return;
    aborted = true;
    abortReason = reason ?? new RequestAbortedError("Request aborted");
    ac.abort(abortReason);
    // Wake the body loop if it is parked in a pause, so it observes the abort.
    resume();
  };

  const controller = {
    abort,
    pause() {
      paused = true;
    },
    resume,
    get aborted() {
      return aborted;
    },
    get reason() {
      return abortReason;
    },
    get paused() {
      return paused;
    },
  };

  // Tracked for close() drain and destroy() abort; done exists before handler callbacks run so a sync close() from onConnect still waits.
  const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
  const entry: PendingEntry = { abort, done };
  pending?.add(entry);

  (async () => {
    const path = opts.path || "/";
    if (typeof path !== "string" || path.charCodeAt(0) !== 0x2f /* '/' */) {
      throw new InvalidArgumentError("path must start with '/'");
    }
    // Concatenate rather than URL-resolve so '//other.host/x' cannot change the request authority.
    const base = origin instanceof URL ? origin : new URL(String(origin));
    const url = new URL(base.origin + path);
    const { query } = opts;
    if (query) {
      if (path.includes("?") || path.includes("#")) {
        throw new InvalidArgumentError('Query params cannot be passed when url already contains "?" or "#".');
      }
      url.search = searchFromQuery(query);
    }
    // Not uppercased, like undici. Transport gap: native fetch sends a name it does not know, or one in mixed case, as GET.
    const method = opts.method ? String(opts.method) : "GET";

    if (isControllerStyle) handler.onRequestStart?.(controller, { __proto__: null });
    else handler.onConnect?.(abort);
    if (aborted) throw abortReason;

    const body = bodyFromDispatchOpts(opts.body);

    const maxRedirections = opts.maxRedirections;
    const followRedirects = typeof maxRedirections === "number" && maxRedirections > 0;
    // Transport gap: fetch() rejects GET/HEAD bodies that undici's own client would send; the loud error beats dropping the body.
    const resp = await nativeFetch(url, {
      method,
      headers: headersFromDispatchOpts(opts.headers),
      body,
      redirect: followRedirects ? "follow" : "manual",
      maxRedirects: followRedirects ? maxRedirections : undefined,
      signal: ac.signal,
      keepalive: !opts.reset,
      ...nativeInit,
    });

    // fetch() already decoded an encoded body, so its encoding and encoded length no longer describe the bytes delivered.
    const responseHeaders = { __proto__: null, ...resp.headers.toJSON() };
    const contentEncoding = responseHeaders["content-encoding"];
    if (method.toUpperCase() !== "HEAD" && contentEncoding !== undefined && nativeFetchDecodes(contentEncoding)) {
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
    }

    if (isControllerStyle) {
      handler.onResponseStart?.(controller, resp.status, responseHeaders, resp.statusText);
    } else if (typeof handler.onHeaders === "function") {
      const rawHeaders: Buffer[] = [];
      for (const name in responseHeaders) {
        const value = responseHeaders[name];
        if ($isJSArray(value)) {
          for (const v of value) rawHeaders.push(Buffer.from(name), Buffer.from(v));
        } else {
          rawHeaders.push(Buffer.from(name), Buffer.from(value));
        }
      }
      if (handler.onHeaders(resp.status, rawHeaders, resume, resp.statusText) === false) paused = true;
    }

    const respBody = resp.body;
    if (respBody) {
      for await (const chunk of respBody as AsyncIterable<Uint8Array>) {
        if (aborted) throw abortReason;
        if (paused) await resumed();
        if (aborted) throw abortReason;
        const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        // Only a legacy onData pauses by returning false; a controller handler pauses through controller.pause().
        if (isControllerStyle) handler.onResponseData?.(controller, buf);
        else if (handler.onData?.(buf) === false) paused = true;
      }
    }

    // A handler that paused on the headers of an empty body, or on the last chunk, gets the end after resume(), as in undici.
    if (paused) await resumed();
    // Covers abort() called from onHeaders on an empty body or from onData on the final chunk.
    if (aborted) throw abortReason;

    if (isControllerStyle) handler.onResponseEnd?.(controller, { __proto__: null });
    else handler.onComplete?.([]);
  })()
    .catch(err => {
      // Cancel the response body when a handler callback threw before the body loop.
      if (!aborted) ac.abort(err);
      try {
        handlerError(handler, controller, err);
      } catch (thrown) {
        // A throwing error callback is the caller's bug: report it as an uncaught exception, like undici, not swallow it.
        queueMicrotask(() => {
          throw thrown;
        });
      }
    })
    .finally(() => {
      pending?.delete(entry);
      resolveDone();
    });

  return true;
}

// Like undici and Response.text(): a leading UTF-8 byte order mark is not part of the text.
function utf8WithoutBOM(buf: Buffer) {
  return buf.length > 2 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
    ? buf.toString("utf8", 3)
    : buf.toString();
}

// The error of request({ throwOnError }), like undici 6: it has the response, and the body when that is JSON or text.
async function responseStatusCodeError(body: DispatchBodyReadable, statusCode: number, statusText, headers) {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      // undici's limit. A longer body is not read to its end.
      if ((length += chunk.length) > 131072) {
        length = 0;
        break;
      }
    }
  } catch {
    length = 0;
  }
  let payload;
  const contentType = headers["content-type"];
  if (length > 0 && typeof contentType === "string") {
    try {
      const text = utf8WithoutBOM(Buffer.concat(chunks, length));
      if (contentType.startsWith("application/json")) payload = JSON.parse(text);
      else if (contentType.startsWith("text/")) payload = text;
    } catch {}
  }
  const message = `Response status code ${statusCode}${statusText ? `: ${statusText}` : ""}`;
  return new ResponseStatusCodeError(message, statusCode, headers, payload);
}

// dispatcher.request() body: a Readable with undici's body-mixin methods.
class DispatchBodyReadable extends Readable {
  #used = false;
  #reading = false;
  #contentType: string | undefined = undefined;
  #onDestroy: (err?: Error) => void = noop;

  constructor(read: () => void, onDestroy: (err?: Error) => void, contentType) {
    super({ read });
    this.#onDestroy = onDestroy;
    this.#contentType = contentType;
  }

  on(event, listener) {
    if (event === "data" || event === "readable") this.#reading = true;
    return super.on(event, listener);
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  _destroy(err, callback) {
    // Like undici, for a body that somebody reads. undici also errors an unread body, which nobody can catch.
    if (!err && (this.#reading || this.#used) && !this._readableState.endEmitted) {
      err = new RequestAbortedError("Request aborted");
    }
    this.#onDestroy(err);
    // Like undici: a body nobody reads yet fails one macrotask later, so a caller that awaited request() can still listen for it.
    if (this.#reading) callback(err);
    else setImmediate(callback, err);
  }

  get bodyUsed() {
    return this.#used || isDisturbed(this);
  }

  async #consume() {
    if (this.#used || isDisturbed(this)) {
      // Like undici: a body that failed rejects with its error, and only a body that was read is "unusable".
      if (this.destroyed && !this._readableState.closeEmitted) {
        const failed = Promise.withResolvers<never>();
        this.on("error", failed.reject).on("close", () => failed.reject(new TypeError("unusable")));
        return failed.promise;
      }
      throw this.errored ?? new TypeError("unusable");
    }
    this.#used = true;
    const chunks: Buffer[] = [];
    for await (const chunk of this as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async text() {
    return utf8WithoutBOM(await this.#consume());
  }

  async json() {
    return JSON.parse(utf8WithoutBOM(await this.#consume()));
  }

  async arrayBuffer() {
    const buf = await this.#consume();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  async bytes() {
    return new Uint8Array(await this.#consume());
  }

  async blob() {
    const buf = await this.#consume();
    return this.#contentType ? new Blob([buf], { type: String(this.#contentType) }) : new Blob([buf]);
  }

  async formData() {
    const buf = await this.#consume();
    const headers = this.#contentType ? { "content-type": String(this.#contentType) } : undefined;
    return await new Response(buf, { headers }).formData();
  }

  // undici's discard idiom: read and drop the body, destroying past the limit.
  async dump(opts) {
    const limit = opts?.limit ?? 131072;
    this.#used = true;
    let read = 0;
    try {
      for await (const chunk of this as AsyncIterable<Buffer>) {
        read += chunk.length;
        if (read > limit) {
          this.destroy();
          break;
        }
      }
    } catch {
      // dump() resolves regardless of how the body ends, like undici
    }
  }
}

// The promise form of a callback API. A synchronous throw rejects, as it would inside a Promise executor.
function promiseForm(run: (callback: (err: unknown, data?: any) => void) => void): Promise<any> {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  try {
    run((err, data) => (err ? reject(err) : resolve(data)));
  } catch (err) {
    reject(err);
  }
  return promise;
}

class Dispatcher extends EventEmitter {
  dispatch(_opts?: any, _handler?: any): boolean {
    throw new Error("not implemented");
  }

  close(_callback?: any): any {
    throw new Error("not implemented");
  }

  destroy(_err?: any, _callback?: any): any {
    throw new Error("not implemented");
  }

  request(opts, callback?) {
    if (callback === undefined) {
      // Not this.request(): the top-level request() runs this on dispatchers that only have dispatch().
      return promiseForm(cb => Dispatcher.prototype.request.$call(this, opts, cb));
    }
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    if (!opts || typeof opts !== "object") {
      queueMicrotask(() => callback(new InvalidArgumentError("opts must be an object."), { opaque: opts?.opaque }));
      return;
    }
    const opaque = opts.opaque ?? null;

    let body: DispatchBodyReadable | null = null;
    let resumeBody: (() => void) | null = null;
    let abortBody: ((reason?: Error) => void) | null = null;
    let completed = false;
    const reqBody = opts.body;
    const signal = opts.signal;
    let onSignalAbort: (() => void) | null = null;
    const removeSignal = () => {
      if (!onSignalAbort) return;
      if (typeof signal.removeEventListener === "function") signal.removeEventListener("abort", onSignalAbort);
      else if (typeof signal.removeListener === "function") signal.removeListener("abort", onSignalAbort);
      onSignalAbort = null;
    };
    const destroyRequestBody = err => {
      if (reqBody && typeof reqBody.destroy === "function" && !reqBody.destroyed) {
        if (typeof reqBody.on === "function") reqBody.on("error", () => {});
        reqBody.destroy(err);
      }
    };
    // undici defers the error callback, so a callback that throws is an uncaught exception and not a dispatch failure.
    const fail = err => queueMicrotask(() => callback(err, { opaque }));
    if (signal?.aborted) {
      const err = signal.reason ?? new RequestAbortedError("Request aborted");
      destroyRequestBody(err);
      fail(err);
      return;
    }
    const trailers = ObjectCreate(null);
    let context = null;
    try {
      this.dispatch(opts, {
        onConnect: (abort, ctx) => {
          // A late onConnect after a terminal callback must not re-register the signal listener.
          if (completed) return;
          abortBody = abort;
          context = ctx ?? null;
          // onConnect may fire once per redirect/retry hop; drop the previous hop's listener first.
          removeSignal();
          // Wired here because DispatchOptions has no signal field; user dispatch() implementations never see it.
          if (signal) {
            onSignalAbort = () => abort(signal.reason);
            if (signal.aborted) onSignalAbort();
            else if (typeof signal.addEventListener === "function")
              signal.addEventListener("abort", onSignalAbort, { once: true });
            else if (typeof signal.on === "function") signal.on("abort", onSignalAbort);
          }
        },
        onHeaders: (statusCode, rawHeaders, resume, statusText) => {
          // onHeaders after a terminal callback violates the contract; a late 1xx must not fire onInfo either.
          if (completed) return true;
          // 1xx informational responses precede the final onHeaders, like undici.
          if (statusCode < 200) {
            if (typeof opts.onInfo === "function")
              opts.onInfo({ statusCode, headers: headersFromRawHeaders(rawHeaders) });
            return true;
          }
          // A second final onHeaders violates the contract; keep the first body.
          if (body !== null) return true;
          resumeBody = resume;
          const headers = headersFromRawHeaders(rawHeaders);
          body = new DispatchBodyReadable(
            () => resumeBody?.(),
            err => {
              // Early body.destroy() cancels the request so the dispatch loop is not left parked.
              removeSignal();
              if (!completed) abortBody?.(err ?? undefined);
            },
            headers["content-type"],
          );
          if (opts.throwOnError && statusCode >= 400) {
            responseStatusCodeError(body, statusCode, statusText, headers).then(fail);
            return true;
          }
          callback(null, {
            statusCode,
            headers,
            body,
            trailers,
            opaque,
            context,
          });
          return true;
        },
        // Copy (the dispatch contract only guarantees the chunk during the callback); drop chunks outside onHeaders..onComplete.
        onData: chunk => (completed || body === null ? true : body.push(Buffer.from(chunk))),
        onComplete: rawTrailers => {
          if (completed) return;
          completed = true;
          removeSignal();
          if (body === null) {
            const err = new TypeError(
              "request completed without a response: onHeaders must be called before onComplete",
            );
            destroyRequestBody(err);
            fail(err);
            return;
          }
          if (rawTrailers && rawTrailers.length) Object.assign(trailers, headersFromRawHeaders(rawTrailers));
          body.push(null);
        },
        onError: err => {
          if (completed) return;
          completed = true;
          removeSignal();
          destroyRequestBody(err);
          if (body) body.destroy(err);
          else fail(err);
        },
      });
    } catch (err) {
      removeSignal();
      destroyRequestBody(err);
      if (completed) return;
      // Terminal like onError: flips completed so callbacks a throwing dispatch() already scheduled are ignored.
      completed = true;
      // Handler callbacks assign body inside the try; TS does not track that, so re-widen it here.
      const openBody = body as DispatchBodyReadable | null;
      if (openBody) openBody.destroy(err as Error);
      else fail(err);
    }
  }
}

const kDispatch = Symbol("kDispatch");
const kPending = Symbol("kPending");
const kNativeInit = Symbol("kNativeInit");
const kFetch = Symbol("kFetch");

type PendingEntry = { abort: (reason?: Error) => void; done: Promise<void> };

// The caller chose the route. A session does not show whether it has a proxy or a unix socket, so any session counts.
function routesItself(options): boolean {
  return (
    typeof options === "object" &&
    options !== null &&
    (options.proxy !== undefined || options.unix != null || options.session != null)
  );
}

class DispatcherBase extends Dispatcher {
  #closed = false;
  #destroyed = false;
  declare [kPending]: Set<PendingEntry>;

  constructor() {
    super();
    this[kPending] = new Set<PendingEntry>();
  }

  get closed() {
    return this.#closed;
  }

  get destroyed() {
    return this.#destroyed;
  }

  close(callback) {
    if (callback === undefined) return promiseForm(cb => this.close(cb));
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    if (this.#destroyed) {
      queueMicrotask(() => callback(new ClientDestroyedError("The client is destroyed"), null));
      return;
    }
    this.#closed = true;
    // Drain, then transition to destroyed, like undici's close().then(() => destroy()).
    Promise.allSettled(Array.from(this[kPending], entry => entry.done)).then(() => {
      this.#destroyed = true;
      queueMicrotask(() => callback(null, null));
    });
  }

  destroy(err, callback) {
    if (typeof err === "function") {
      callback = err;
      err = null;
    }
    if (callback === undefined) return promiseForm(cb => this.destroy(err, cb));
    if (typeof callback !== "function") throw new InvalidArgumentError("invalid callback");
    this.#destroyed = true;
    this.#closed = true;
    const reason = err ?? new ClientDestroyedError("The client is destroyed");
    for (const entry of this[kPending]) entry.abort(reason);
    Promise.allSettled(Array.from(this[kPending], entry => entry.done)).then(() =>
      queueMicrotask(() => callback(null, null)),
    );
  }

  dispatch(opts, handler) {
    if (!handler || typeof handler !== "object") throw new InvalidArgumentError("handler must be an object");
    if (
      !isControllerHandler(handler) &&
      typeof handler.onError !== "function" &&
      typeof handler.onResponseError !== "function"
    ) {
      // Matches undici: a legacy handler without an error callback would make async failures unobservable.
      throw new InvalidArgumentError("invalid onError method");
    }
    try {
      if (!opts || typeof opts !== "object") throw new InvalidArgumentError("opts must be an object.");
      if (this.#destroyed) throw new ClientDestroyedError("The client is destroyed");
      if (this.#closed) throw new ClientClosedError("The client is closed");
      return this[kDispatch](opts, handler);
    } catch (err) {
      handlerError(handler, null, err);
      return false;
    }
  }

  [kDispatch](_opts?: any, _handler?: any): boolean {
    notImplemented();
  }

  // Extra native fetch options when fetch() through this dispatcher equals native fetch; undefined means fetch() must dispatch().
  [kNativeInit](): { proxy?: unknown } | undefined {
    return undefined;
  }

  // fetch() through a route-only dispatcher is the native fetch it was before dispatchers worked, plus the agent's proxy.
  [kFetch](input, init): Promise<Response> {
    if (this.#destroyed) return Promise.reject(new ClientDestroyedError("The client is destroyed"));
    if (this.#closed) return Promise.reject(new ClientClosedError("The client is closed"));
    const proxy = this[kNativeInit]()?.proxy;
    // The caller's own init object, so nothing about the call changes. close() and destroy() do not track it.
    if (proxy === undefined) return nativeFetch(input, init);
    try {
      if (routesItself(init) || routesItself(input)) return nativeFetch(input, init);
      if (init == null) return nativeFetch(input, { proxy });
      // Bun accepts a Request as init. Its fields are internal, so it becomes part of the input.
      if (init instanceof Request) return nativeFetch(new Request(input, init as any), { proxy });
      // Not a copy: native fetch reads each option with a property get, and a copy would lose the inherited ones.
      return nativeFetch(input, { __proto__: init, proxy });
    } catch (err) {
      return Promise.reject(err);
    }
  }
}

function noop() {}

// True when fetch() through the dispatcher equals native fetch: a stock Agent or proxy agent whose dispatch() nobody overrode.
function isRouteOnly(dispatcher) {
  return (
    dispatcher.dispatch === DispatcherBase.prototype.dispatch &&
    typeof dispatcher[kNativeInit] === "function" &&
    dispatcher[kNativeInit]() !== undefined
  );
}

// Pool, Client and BalancedPool connect to their origin directly, as in undici. Native fetch reads HTTP_PROXY otherwise.
const kDirect = Object.freeze({ proxy: false });

// Agent, ProxyAgent and EnvHttpProxyAgent route by opts.origin.
function dispatchToOrigin(agent, opts, handler) {
  if (!opts.origin) throw new InvalidArgumentError("opts.origin must be a non-empty string or URL.");
  return fetchDispatch(parseOrigin(opts.origin), opts, handler, agent[kPending], agent[kNativeInit]());
}

class Agent extends DispatcherBase {
  constructor(_options?: object) {
    super();
  }

  [kDispatch](opts, handler) {
    return dispatchToOrigin(this, opts, handler);
  }

  // No proxy option: an Agent keeps native fetch's default, which reads HTTP_PROXY. undici's Agent connects directly.
  [kNativeInit]() {
    return kEmptyObject;
  }
}

class Pool extends DispatcherBase {
  #origin: URL | undefined = undefined;

  constructor(origin, _options) {
    super();
    if (origin == null) throw new InvalidArgumentError("Origin must be a string or URL.");
    this.#origin = parseOrigin(origin);
  }

  [kDispatch](opts, handler) {
    return fetchDispatch(this.#origin!, opts, handler, this[kPending], kDirect);
  }
}

class BalancedPool extends DispatcherBase {
  #upstreams: URL[] = [];

  constructor(upstreams = [], _options) {
    super();
    this.#upstreams = ($isJSArray(upstreams) ? upstreams : [upstreams]).map(parseOrigin);
  }

  [kDispatch](opts, handler) {
    const upstream = this.#upstreams[0];
    if (!upstream) throw new BalancedPoolMissingUpstreamError("No upstream has been added to the BalancedPool");
    return fetchDispatch(upstream, opts, handler, this[kPending], kDirect);
  }
}

class Client extends DispatcherBase {
  #origin: URL | undefined = undefined;

  constructor(origin, _options) {
    super();
    if (origin == null) throw new InvalidArgumentError("Origin must be a string or URL.");
    this.#origin = parseOrigin(origin);
  }

  [kDispatch](opts, handler) {
    return fetchDispatch(this.#origin!, opts, handler, this[kPending], kDirect);
  }
}

class ProxyAgent extends DispatcherBase {
  #nativeInit: { proxy: unknown } | undefined = undefined;

  constructor(opts) {
    super();
    if (typeof opts === "string" || opts instanceof URL) opts = { uri: opts };
    if (opts == null || typeof opts !== "object") throw new InvalidArgumentError("Proxy uri is mandatory");
    const { uri, token, auth } = opts;
    if (!uri || (typeof uri !== "string" && !(uri instanceof URL))) {
      throw new InvalidArgumentError("Proxy uri is mandatory");
    }
    if (token != null && auth != null) {
      throw new InvalidArgumentError("opts.auth cannot be used in combination with opts.token");
    }
    if (token != null && typeof token !== "string") throw new InvalidArgumentError("opts.token must be a string");
    if (auth != null && typeof auth !== "string") throw new InvalidArgumentError("opts.auth must be a string");
    const headers = { ...opts.headers };
    if (token != null) headers["proxy-authorization"] = token;
    else if (auth != null) headers["proxy-authorization"] = `Basic ${auth}`;
    // Native fetch's `proxy` option does the proxying. Like undici, a ProxyAgent proxies every host, NO_PROXY or not.
    this.#nativeInit = { proxy: { url: String(uri), headers, respectNoProxy: false } };
  }

  [kDispatch](opts, handler) {
    return dispatchToOrigin(this, opts, handler);
  }

  [kNativeInit]() {
    return this.#nativeInit;
  }
}

// Native fetch applies HTTP_PROXY, HTTPS_PROXY and NO_PROXY itself on every redirect hop, so this agent adds no option.
class EnvHttpProxyAgent extends DispatcherBase {
  // The httpProxy, httpsProxy and noProxy options are not applied. wrangler passes noProxy at startup, so they must not throw.
  constructor(_options?: object) {
    super();
  }

  [kDispatch](opts, handler) {
    return dispatchToOrigin(this, opts, handler);
  }

  [kNativeInit]() {
    return kEmptyObject;
  }
}

class RetryAgent extends DispatcherBase {
  #agent: any = undefined;

  constructor(agent, _options) {
    super();
    if (!agent || typeof agent.dispatch !== "function") {
      throw new InvalidArgumentError("Argument opts.agent must implement Agent");
    }
    this.#agent = agent;
  }

  [kDispatch](opts, handler) {
    return this.#agent.dispatch(opts, handler);
  }

  [kNativeInit]() {
    return isRouteOnly(this.#agent) ? this.#agent[kNativeInit]() : undefined;
  }

  [kFetch](input, init) {
    return this.#agent[kFetch](input, init);
  }

  get closed() {
    return this.#agent.closed;
  }

  get destroyed() {
    return this.#agent.destroyed;
  }

  close(callback) {
    return this.#agent.close(callback);
  }

  destroy(err, callback) {
    return this.#agent.destroy(err, callback);
  }
}

// Interception is not implemented: a MockAgent sends its requests to the network like an Agent, as it always has in Bun.
class MockAgent extends Agent {}

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
class ResponseStatusCodeError extends UndiciError {
  body: unknown = undefined;
  headers: unknown = undefined;
  status: number | undefined = undefined;
  statusCode: number | undefined = undefined;

  constructor(message?: string, statusCode?: number, headers?: unknown, body?: unknown) {
    super(message);
    this.name = "ResponseStatusCodeError";
    this.code = "UND_ERR_RESPONSE_STATUS_CODE";
    this.body = body;
    this.status = statusCode;
    this.statusCode = statusCode;
    this.headers = headers;
  }
}
class InvalidArgumentError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "InvalidArgumentError";
    this.code = "UND_ERR_INVALID_ARG";
  }
}
class InvalidReturnValueError extends UndiciError {}
class RequestAbortedError extends AbortError {
  constructor(message) {
    super(message);
    this.name = "AbortError";
    this.code = "UND_ERR_ABORTED";
  }
}
class ClientDestroyedError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "ClientDestroyedError";
    this.code = "UND_ERR_DESTROYED";
  }
}
class ClientClosedError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "ClientClosedError";
    this.code = "UND_ERR_CLOSED";
  }
}
class InformationalError extends UndiciError {}
class SocketError extends UndiciError {}
class NotSupportedError extends UndiciError {}
class ResponseContentLengthMismatchError extends UndiciError {}
class BalancedPoolMissingUpstreamError extends UndiciError {
  constructor(message) {
    super(message);
    this.name = "MissingUpstreamError";
    this.code = "UND_ERR_BPL_MISSING_UPSTREAM";
  }
}
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

const pingChannel = dc.channel("undici:websocket:ping");
const pongChannel = dc.channel("undici:websocket:pong");

function toBuffer(data: ArrayBufferView | ArrayBuffer | Blob) {
  if ($isTypedArrayView(data)) return data;
  // A received frame's Blob is in memory, so arrayBuffer() returns an already-fulfilled promise.
  return Buffer.from(isArrayBuffer(data) ? data : $peekPromiseSettledValue(data.arrayBuffer()));
}

interface FrameEvent {
  data: ArrayBufferView | ArrayBuffer | Blob;
  target: WebSocket;
}

function onPing(event: FrameEvent) {
  if (pingChannel.hasSubscribers) pingChannel.publish({ payload: toBuffer(event.data), websocket: event.target });
}

function onPong(event: FrameEvent) {
  if (pongChannel.hasSubscribers) pongChannel.publish({ payload: toBuffer(event.data), websocket: event.target });
}

class WebSocket extends BunWebSocket {
  constructor(url: string | URL, protocols?: string | string[] | object) {
    super(url, protocols);
    this.addEventListener("ping", onPing);
    this.addEventListener("pong", onPong);
  }
}

function ping(ws: WebSocket, body?: Buffer) {
  if (Buffer.isBuffer(body)) {
    if (body!.length > 125) throw new TypeError("A PING frame cannot have a body larger than 125 bytes.");
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

let globalDispatcher: Dispatcher | undefined;
let defaultGlobalAgent: Agent | undefined;

// Add missing dispatcher functions
function setGlobalDispatcher(dispatcher: Dispatcher) {
  if (!dispatcher || typeof dispatcher.dispatch !== "function") {
    throw new InvalidArgumentError("Argument agent must implement Agent");
  }
  globalDispatcher = dispatcher;
}

function getGlobalDispatcher() {
  // The lazy default lives apart from globalDispatcher so calling this never reroutes bare fetch().
  return globalDispatcher ?? (defaultGlobalAgent ??= new Agent());
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

function isReplayableBody(body) {
  return (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams
  );
}

// The stream Bun makes over a body it holds in memory. A file or a network stream has another source class.
function isInMemoryBodyStream(stream) {
  const source = stream?.$bunNativePtr;
  return (
    typeof source === "object" &&
    source !== null &&
    ObjectPrototypeToString.$call(source) === "[object BlobInternalReadableStreamSource]"
  );
}

// The byte length of a body that Bun has in memory: a clone shares the bytes, and blob() of it settles before it returns.
function inMemoryBodySize(source: Request | Response): number | undefined {
  const blob = source.clone().blob();
  return $peekPromiseStatus(blob) === 1 ? ($peekPromiseSettledValue(blob) as Blob).size : undefined;
}

// Like native fetch: a username or password that does not decode sends no credentials, and does not fail the request.
function basicAuthorization(url: URL) {
  try {
    const userinfo = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    return `Basic ${Buffer.from(userinfo).toString("base64")}`;
  } catch {
    return undefined;
  }
}

let lazyZlib: any;

// "deflate" is the zlib format, but some servers send the raw deflate stream. The first byte tells them apart.
class InflateStream extends Transform {
  #options: object | undefined = undefined;
  #inflate: any = undefined;

  constructor(options: object) {
    super();
    this.#options = options;
  }

  _transform(chunk, encoding, callback) {
    let inflate = this.#inflate;
    if (inflate === undefined) {
      if (chunk.length === 0) return callback();
      const raw = (chunk[0] & 0x0f) !== 0x08;
      inflate = this.#inflate = raw ? lazyZlib.createInflateRaw(this.#options) : lazyZlib.createInflate(this.#options);
      inflate.on("error", err => this.destroy(err));
      // A paused inflate fills its own buffer and then stops, so one small chunk cannot inflate without bound.
      inflate.on("data", data => {
        if (!this.push(data)) inflate.pause();
      });
      // Also fires early, when bytes follow the end of the deflate stream. zlib then never completes that write.
      inflate.on("end", () => this.push(null));
    }
    inflate.write(chunk, encoding, callback);
  }

  _read(size) {
    this.#inflate?.resume();
    super._read(size);
  }

  // Transform ends the output when this calls back, so it waits for the inflate, which may be paused with bytes inside.
  _final(callback) {
    const inflate = this.#inflate;
    if (inflate === undefined || inflate.readableEnded) return callback();
    inflate.once("end", callback).end();
  }

  _destroy(err, callback) {
    this.#inflate?.destroy();
    callback(err);
  }
}

// The decoders for a content-encoding value, in the order they run. Undefined means the body stays as it came.
function contentDecoders(contentEncoding: string) {
  const codings = contentEncoding.toLowerCase().split(",");
  // undici's limit: each coding is one more decoder that a small body can be made to inflate through.
  const { length } = codings;
  if (length > 5) {
    throw new TypeError(`too many content-encodings in response: ${length}, maximum allowed is 5`);
  }
  for (let i = 0; i < length; i++) {
    const coding = (codings[i] = codings[i].trim());
    // One unknown coding leaves the whole body as it came, like undici.
    if (coding !== "gzip" && coding !== "x-gzip" && coding !== "deflate" && coding !== "br" && coding !== "zstd") {
      return undefined;
    }
  }
  const zlib = (lazyZlib ??= require("node:zlib"));
  const constants = zlib.constants;
  // The flush modes of undici's fetch: a truncated body gives the bytes that arrived, not an error.
  const deflate = { flush: constants.Z_SYNC_FLUSH, finishFlush: constants.Z_SYNC_FLUSH };
  const brotli = { flush: constants.BROTLI_OPERATION_FLUSH, finishFlush: constants.BROTLI_OPERATION_FLUSH };
  const zstd = { flush: constants.ZSTD_e_continue, finishFlush: constants.ZSTD_e_end };
  const decoders: any[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const coding = codings[i];
    if (coding === "deflate") decoders.push(new InflateStream(deflate));
    else if (coding === "br") decoders.push(zlib.createBrotliDecompress(brotli));
    else if (coding === "zstd") decoders.push(zlib.createZstdDecompress(zstd));
    else decoders.push(zlib.createGunzip(deflate));
  }
  return decoders;
}

// A fetch() body that nobody reads buffers this many bytes, then the dispatcher is asked to pause.
const kBodyBufferBytes = 65536;

function chunkByteLength(chunk) {
  return chunk.byteLength;
}

// Zero, so pull() runs only while a read waits. The size is in bytes, for the buffer limit.
const kBodyQueuing = { highWaterMark: 0, size: chunkByteLength };

function runHeldValue(held: () => void) {
  held();
}

// Cancels the dispatch behind a fetch() response body that was collected unread, as undici does.
let abandonedBodies: FinalizationRegistry<() => void> | undefined;

// fetch through a dispatcher that is not route-only: every hop goes through dispatcher.dispatch(), as in undici.
function fetchViaDispatcher(dispatcher, input, init) {
  let url: URL, method: string, headers: Headers, body: any, signal: any, redirect: any;
  // Holds a body that Bun has in memory, or a file, and is never read itself: each clone of it is one more sendable body.
  let replay: Request | Response | undefined;
  let size: number | undefined;
  // Input parsing failures reject the returned promise like WHATWG fetch, never throw synchronously.
  try {
    let request = input instanceof Request ? input : undefined;
    let target = request ? request.url : input;
    let options;
    if (!request && typeof input === "object" && input !== null && !(input instanceof URL)) {
      // The order of native fetch: an object whose string is a URL is that URL, and any other is Bun's { url, ...options }.
      target = URL.parse(String(input)) ?? (options = input).url;
    }
    url = target instanceof URL ? target : new URL(String(target));
    // Only http(s) is dispatched, like undici's scheme fetch; data:, blob:, file: and s3: URLs stay with native fetch.
    if (url.protocol !== "http:" && url.protocol !== "https:") return nativeFetch(input, init);
    if (options) request = new Request(options);
    method = String((init.method ?? request?.method) || "GET");
    headers = new Headers(init.headers ?? request?.headers);
    // A present `signal: null` detaches the Request's own signal, as in native fetch.
    signal = init.signal === undefined ? request?.signal : init.signal;
    redirect = init.redirect ?? request?.redirect ?? "follow";
    // WHATWG fetch normalizes only these six methods; others keep their case.
    const upper = method.toUpperCase();
    if (
      upper === "DELETE" ||
      upper === "GET" ||
      upper === "HEAD" ||
      upper === "OPTIONS" ||
      upper === "POST" ||
      upper === "PUT"
    ) {
      method = upper;
    }
    const initBody = init.body;
    if (initBody == null) {
      if (request && method !== "GET" && method !== "HEAD") {
        // Cloned before the body is read: a body in memory stays in memory in the clone, and a stream body is teed.
        const spare = request.clone();
        body = request.body;
        // undici does not send a stream twice, and the unread half of a tee would hold the whole upload.
        if (isInMemoryBodyStream(body)) {
          replay = spare;
          size = inMemoryBodySize(spare);
        } else {
          spare.body?.cancel();
        }
      }
    } else if (isReplayableBody(initBody)) {
      // Bun's own body extraction copies the bytes once and derives the content-type, the form boundary included.
      replay = new Response(initBody);
      const type = replay.headers.get("content-type");
      if (type !== null && !headers.has("content-type")) headers.set("content-type", type);
      body = replay.clone().body;
      // blob() would convert a string once more, and would read a file that is not regular. The size of a file is a stat.
      if (typeof initBody === "string") size = Buffer.byteLength(initBody);
      else if (initBody instanceof Blob) size = initBody.size;
      else size = inMemoryBodySize(replay);
    } else {
      body = initBody;
    }
    // Like undici: without the length, a dispatcher can only send the stream it gets with chunked encoding.
    if (size !== undefined) {
      if (size < Infinity) headers.set("content-length", String(size));
    } else if (body == null && (method === "POST" || method === "PUT")) {
      headers.set("content-length", "0");
    }
    // The dispatch options carry only origin and path, so URL userinfo becomes Basic auth here, as native fetch does.
    if ((url.username || url.password) && !headers.has("authorization")) {
      const authorization = basicAuthorization(url);
      if (authorization !== undefined) headers.set("authorization", authorization);
    }
    // A pre-aborted signal rejects before the dispatcher is ever invoked, like WHATWG fetch.
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  } catch (err) {
    return Promise.reject(err);
  }

  const deferred = Promise.withResolvers<Response>();
  let resolve: ((response: Response) => void) | null = deferred.resolve;
  let reject: ((reason: unknown) => void) | null = deferred.reject;
  let settled = false;
  // The resolving functions hold the promise and the promise holds the Response, so they go once it settled.
  const settle = (fulfilled: boolean, value) => {
    const resolver = fulfilled ? resolve : reject;
    settled = true;
    resolve = reject = null;
    resolver!(value);
  };
  let redirects = 0;
  // The dispatcher holds these callbacks, so a strong reference would keep an abandoned body alive forever.
  let bodyController: WeakRef<ReadableStreamDefaultController> | null = null;
  // Strong while a read waits for data: nothing else holds a body that is being read, nor the caller awaiting it.
  let readingController: ReadableStreamDefaultController | null = null;
  const takeController = () => {
    const controller = readingController ?? bodyController?.deref();
    readingController = bodyController = null;
    return controller;
  };
  let abortHop: ((reason?: Error) => void) | null = null;
  let onSignalAbort: (() => void) | null = null;
  const removeSignal = () => {
    if (!onSignalAbort) return;
    if (typeof signal.removeEventListener === "function") signal.removeEventListener("abort", onSignalAbort);
    else if (typeof signal.removeListener === "function") signal.removeListener("abort", onSignalAbort);
    onSignalAbort = null;
  };
  const routeError = err => {
    removeSignal();
    // Taken so a late onData cannot park the dispatcher on the orphaned stream's backpressure.
    const controller = takeController();
    if (!settled) settle(false, err);
    else controller?.error(err);
  };
  // Applies the WHATWG redirect rules to the request state; throws when the redirect cannot be followed.
  const redirectTo = (statusCode: number, location: string) => {
    if (++redirects > 20) throw new TypeError("redirect count exceeded");
    const next = new URL(location, url);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new TypeError("URL scheme must be a HTTP(S) scheme");
    }
    // The fetch standard checks this before the method changes: only a 303 may follow with a body that has no source.
    if (statusCode !== 303 && body != null && !replay) {
      throw new TypeError(
        `Cannot follow the ${statusCode} redirect to ${next.origin}: a stream body cannot be sent twice`,
      );
    }
    if (
      statusCode === 303
        ? method !== "GET" && method !== "HEAD"
        : (statusCode === 301 || statusCode === 302) && method === "POST"
    ) {
      method = "GET";
      body = undefined;
      replay = undefined;
      headers.delete("content-encoding");
      headers.delete("content-language");
      headers.delete("content-location");
      headers.delete("content-type");
      headers.delete("content-length");
    } else if (replay) {
      body = replay.clone().body;
    }
    if (next.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("proxy-authorization");
      headers.delete("cookie");
      headers.delete("host");
    }
    url = next;
  };
  const dispatchHop = () => {
    // False once this hop reached a terminal callback or a redirect replaced it; its later callbacks are ignored.
    let live = true;
    let resumeData: (() => void) | null = null;
    // For an encoded body: the dispatcher's chunks go into decodeInput, and the reads take from decodeOutput.
    let decodeInput: any = null;
    let decodeOutput: any = null;
    const endHop = () => {
      live = false;
      abandonedBodies?.unregister(cancelBody);
    };
    const fail = err => {
      if (!live) return;
      endHop();
      routeError(err);
      decodeInput?.destroy();
    };
    // The reader cancelled the response body, or the body was collected unread.
    const cancelBody = (reason?: unknown) => {
      const wasLive = live;
      if (wasLive) {
        endHop();
        removeSignal();
      }
      takeController();
      decodeInput?.destroy();
      if (wasLive) abortHop?.(reason instanceof Error ? reason : undefined);
    };
    const wantData = () => resumeData?.();
    // Decoded bytes go to the body only while a read waits, so the decoders hold them and their own backpressure applies.
    const pumpDecoded = () => {
      let controller;
      while ((controller = readingController) !== null) {
        const chunk = decodeOutput.read();
        if (chunk === null) return;
        readingController = null;
        // enqueue() runs pull() again when one more read waits.
        controller.enqueue(chunk);
      }
    };
    const closeBody = () => takeController()?.close();
    let decodeDone = false;
    const decodeFinished = () => {
      decodeDone = true;
      closeBody();
      // Bytes followed the end of the encoded stream. They are dropped, and must not leave the dispatcher paused.
      if (live) {
        decodeInput.destroy();
        resumeData?.();
      }
    };
    // The pipeline ended: with an error when a decoder failed, or when this hop destroyed it.
    const decodeEnded = err => {
      if (!err || decodeDone) return;
      if (live) {
        const abort = abortHop;
        fail(err);
        abort?.(err);
      } else {
        takeController()?.error(err);
      }
    };
    try {
      dispatcher.dispatch(
        {
          origin: url.origin,
          path: url.pathname + url.search,
          method,
          headers: headers.toJSON(),
          body,
          // fetch follows redirects itself, one dispatch per hop, so every hop passes through the dispatcher.
          maxRedirections: 0,
        },
        {
          onConnect: abort => {
            if (!live || settled) return;
            abortHop = abort;
            // onConnect may fire once per retry; drop the previous listener first.
            removeSignal();
            // Wired here because DispatchOptions has no signal field; user dispatch() implementations never see it.
            if (signal) {
              onSignalAbort = () => abort(signal.reason);
              if (signal.aborted) onSignalAbort();
              else if (typeof signal.addEventListener === "function")
                signal.addEventListener("abort", onSignalAbort, { once: true });
              else if (typeof signal.on === "function") signal.on("abort", onSignalAbort);
            }
          },
          onHeaders: (statusCode, rawHeaders, resume, statusText) => {
            // A second final onHeaders, or one after a terminal callback, violates the dispatch contract.
            if (statusCode < 200 || !live || settled) return true;
            if (
              redirect !== "manual" &&
              (statusCode === 301 ||
                statusCode === 302 ||
                statusCode === 303 ||
                statusCode === 307 ||
                statusCode === 308)
            ) {
              if (redirect === "error") {
                const err = new TypeError(`Redirect response '${statusCode}' received when redirect mode is 'error'`);
                const abort = abortHop;
                fail(err);
                abort?.(err);
                return true;
              }
              let location;
              for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
                if (String(rawHeaders[i]).toLowerCase() === "location") location = String(rawHeaders[i + 1]);
              }
              if (location !== undefined) {
                const abort = abortHop;
                try {
                  redirectTo(statusCode, location);
                } catch (err) {
                  fail(err);
                  abort?.(err as Error);
                  return true;
                }
                // undici drops the connection of a redirect response instead of reading its body.
                live = false;
                removeSignal();
                abortHop = null;
                abort?.();
                dispatchHop();
                return true;
              }
            }
            resumeData = resume;
            const responseHeaders: [string, string][] = [];
            let contentEncoding = "";
            for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
              const name = String(rawHeaders[i]);
              const value = String(rawHeaders[i + 1]);
              responseHeaders.push([name, value]);
              if (name.toLowerCase() === "content-encoding") contentEncoding += contentEncoding ? "," + value : value;
            }
            let responseBody: ReadableStream | null = null;
            const nullBody = statusCode === 204 || statusCode === 205 || statusCode === 304;
            if (!nullBody && method !== "HEAD") {
              if (contentEncoding) {
                let decoders;
                try {
                  decoders = contentDecoders(contentEncoding);
                } catch (err) {
                  const abort = abortHop;
                  fail(err);
                  abort?.(err as Error);
                  return true;
                }
                if (decoders !== undefined) {
                  decodeInput = new Readable({ read: wantData });
                  decodeOutput = pipelineStreams([decodeInput, ...decoders], decodeEnded);
                  decodeOutput.on("readable", pumpDecoded).on("end", decodeFinished);
                }
              }
              responseBody = new ReadableStream(
                {
                  start(controller: ReadableStreamDefaultController) {
                    bodyController = new SafeWeakRef(controller);
                  },
                  pull(controller: ReadableStreamDefaultController) {
                    readingController = controller;
                    if (decodeOutput !== null) pumpDecoded();
                    else resumeData?.();
                  },
                  cancel: cancelBody,
                },
                kBodyQueuing,
              );
            }
            // Built before the promise settles so a non-constructible status rejects; the constructor cannot set url or redirected.
            const response = new Response(responseBody, { status: statusCode, statusText, headers: responseHeaders });
            if (responseBody) {
              (abandonedBodies ??= new SafeFinalizationRegistry(runHeldValue)).register(
                responseBody,
                cancelBody,
                cancelBody,
              );
            }
            settle(true, response);
            return true;
          },
          onData: chunk => {
            if (!live) return true;
            // Copied: the dispatch contract only guarantees the chunk during the callback.
            if (decodeInput !== null) return decodeDone || decodeInput.push(Buffer.from(chunk));
            const controller = readingController ?? bodyController?.deref();
            if (!controller) return true;
            readingController = null;
            controller.enqueue(new Uint8Array(chunk));
            // enqueue() ran pull() again if one more read already waits. If none does, the body buffers up to its limit.
            return readingController !== null || (controller.desiredSize ?? 0) > -kBodyBufferBytes;
          },
          onComplete: () => {
            if (!live) return;
            endHop();
            removeSignal();
            if (!settled) {
              settle(
                false,
                new TypeError(
                  `fetch failed for ${url.origin}: the dispatcher completed without calling onHeaders; onHeaders must be called before onComplete`,
                ),
              );
              return;
            }
            // A decoded body ends when its decoders gave their last bytes.
            if (decodeInput === null) closeBody();
            else if (!decodeDone) decodeInput.push(null);
          },
          onError: fail,
        },
      );
    } catch (err) {
      // A dispatcher that throws synchronously after resolving must error the body, not vanish into the executor.
      fail(err);
    }
  };
  dispatchHop();
  return deferred.promise;
}

function fetch(input, init) {
  // Raw module-local on purpose: nativeFetch stays the fast path until setGlobalDispatcher() installs one.
  const dispatcher = init?.dispatcher ?? globalDispatcher;
  if (dispatcher && typeof dispatcher.dispatch === "function") {
    if (isRouteOnly(dispatcher)) return dispatcher[kFetch](input, init);
    return fetchViaDispatcher(dispatcher, input, init ?? kEmptyObject);
  }
  return nativeFetch(input, init);
}
const { preconnect } = nativeFetch;
if (preconnect) fetch.preconnect = preconnect;

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

(moduleExports as typeof moduleExports & { default?: unknown }).default = moduleExports;
export default moduleExports;
