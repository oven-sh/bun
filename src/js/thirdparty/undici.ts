const EventEmitter = require("node:events");
const dc = require("node:diagnostics_channel");
const { isArrayBuffer } = require("node:util/types");
const { Readable } = require("node:stream");
const { Buffer } = require("node:buffer");
const { _ReadableFromWeb: ReadableFromWeb } = require("internal/webstreams_adapters");
const { isDisturbed } = require("internal/streams/utils");

const ObjectCreate = Object.create;
const kEmptyObject = Object.freeze(ObjectCreate(null));

// The loose overload keeps request()'s extra init fields accepted; the intersection keeps preconnect typed.
const nativeFetch: typeof Bun.fetch & ((input: string | URL | Request, init?: object) => Promise<Response>) =
  Bun.fetch;
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

  const resp: Response & { trailers?: undefined } = await nativeFetch(url, {
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

// One fetch()-backed request driving legacy (onHeaders/onData) or v7 controller (onResponseStart/...) handler callbacks.
function fetchDispatch(origin: URL, opts: any, handler: any, pending?: Set<PendingEntry>) {
  const isControllerStyle =
    typeof handler.onRequestStart === "function" || typeof handler.onResponseStart === "function";

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
  let resolveDone: () => void;
  const entry: PendingEntry = { abort, done: new Promise<void>(r => (resolveDone = r)) };
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
      url.search = new URLSearchParams(query).toString();
    }
    // The dispatch layer preserves method case, like undici.
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
    });

    // fetch() already decompressed the body, so drop the encoding headers.
    const responseHeaders = { __proto__: null, ...resp.headers.toJSON() };
    if (method.toUpperCase() !== "HEAD") {
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
        while (paused) {
          await new Promise<void>(r => {
            resumeResolve = r;
          });
        }
        if (aborted) throw abortReason;
        const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        const ret = isControllerStyle ? handler.onResponseData?.(controller, buf) : handler.onData?.(buf);
        if (ret === false) paused = true;
      }
    }

    // Covers abort() called from onHeaders on an empty body or from onData on the final chunk.
    if (aborted) throw abortReason;

    if (isControllerStyle) handler.onResponseEnd?.(controller, { __proto__: null });
    else handler.onComplete?.([]);
  })()
    .catch(err => {
      // Cancel the response body when a handler callback threw before the body loop.
      if (!aborted) ac.abort(err);
      try {
        if (isControllerStyle && typeof handler.onResponseError === "function")
          handler.onResponseError(controller, err);
        else if (typeof handler.onError === "function") handler.onError(err);
        else if (typeof handler.onResponseError === "function") handler.onResponseError(controller, err);
      } catch {
        // A throwing error callback must not become an unhandled rejection.
      }
    })
    .finally(() => {
      pending?.delete(entry);
      resolveDone();
    });

  return true;
}

// dispatcher.request() body: a Readable with undici's body-mixin methods.
class DispatchBodyReadable extends Readable {
  #used = false;
  #contentType;

  constructor(options, contentType) {
    super(options);
    this.#contentType = contentType;
  }

  get bodyUsed() {
    return this.#used || isDisturbed(this);
  }

  async #consume() {
    if (this.#used || isDisturbed(this)) throw new TypeError("unusable");
    this.#used = true;
    const chunks: Buffer[] = [];
    for await (const chunk of this as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async text() {
    return (await this.#consume()).toString();
  }

  async json() {
    return JSON.parse((await this.#consume()).toString());
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

  request(opts, callback) {
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.request(opts, (err, data) => (err ? reject(err) : resolve(data)));
      });
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
    if (signal?.aborted) {
      const err = signal.reason ?? new RequestAbortedError("Request aborted");
      destroyRequestBody(err);
      queueMicrotask(() => callback(err, { opaque }));
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
        onHeaders: (statusCode, rawHeaders, resume, _statusText) => {
          // 1xx informational responses precede the final onHeaders, like undici.
          if (statusCode < 200) {
            if (typeof opts.onInfo === "function")
              opts.onInfo({ statusCode, headers: headersFromRawHeaders(rawHeaders) });
            return true;
          }
          // onHeaders after a terminal callback or a second final onHeaders violates the contract; ignore it.
          if (completed || body !== null) return true;
          resumeBody = resume;
          const headers = headersFromRawHeaders(rawHeaders);
          body = new DispatchBodyReadable(
            {
              read() {
                resumeBody?.();
              },
              destroy(err, cb) {
                // Early body.destroy() cancels the request so the dispatch loop is not left parked.
                removeSignal();
                if (!completed) abortBody?.(err ?? undefined);
                cb(err);
              },
            },
            headers["content-type"],
          );
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
            callback(err, { opaque });
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
          else callback(err, { opaque });
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
      else callback(err, { opaque });
    }
  }
}

const kDispatch = Symbol("kDispatch");
const kPending = Symbol("kPending");

type PendingEntry = { abort: (reason?: Error) => void; done: Promise<void> };

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
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.close((err, data) => (err ? reject(err) : resolve(data)));
      });
    }
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
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.destroy(err, (e, data) => (e ? reject(e) : resolve(data)));
      });
    }
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
    if (typeof handler.onError !== "function" && typeof handler.onResponseError !== "function") {
      // Matches undici: without an error callback, async failures would be unobservable.
      throw new InvalidArgumentError("invalid onError method");
    }
    try {
      if (!opts || typeof opts !== "object") throw new InvalidArgumentError("opts must be an object.");
      if (this.#destroyed) throw new ClientDestroyedError("The client is destroyed");
      if (this.#closed) throw new ClientClosedError("The client is closed");
      return this[kDispatch](opts, handler);
    } catch (err) {
      // The guard above proves one of the two callbacks exists.
      if (typeof handler.onError === "function") handler.onError(err);
      else handler.onResponseError(null, err);
      return false;
    }
  }

  [kDispatch](_opts?: any, _handler?: any): boolean {
    notImplemented();
  }
}

class Agent extends DispatcherBase {
  constructor(_options?: object) {
    super();
  }

  [kDispatch](opts, handler) {
    if (!opts.origin) throw new InvalidArgumentError("opts.origin must be a non-empty string or URL.");
    return fetchDispatch(parseOrigin(opts.origin), opts, handler, this[kPending]);
  }
}

class Pool extends DispatcherBase {
  #origin;

  constructor(origin, _options) {
    super();
    if (origin == null) throw new InvalidArgumentError("Origin must be a string or URL.");
    this.#origin = parseOrigin(origin);
  }

  [kDispatch](opts, handler) {
    return fetchDispatch(this.#origin, opts, handler, this[kPending]);
  }
}

class BalancedPool extends DispatcherBase {
  #upstreams;

  constructor(upstreams = [], _options) {
    super();
    this.#upstreams = ($isJSArray(upstreams) ? upstreams : [upstreams]).map(parseOrigin);
  }

  [kDispatch](opts, handler) {
    const upstream = this.#upstreams[0];
    if (!upstream) throw new BalancedPoolMissingUpstreamError("No upstream has been added to the BalancedPool");
    return fetchDispatch(upstream, opts, handler, this[kPending]);
  }
}

class Client extends DispatcherBase {
  #origin;

  constructor(origin, _options) {
    super();
    if (origin == null) throw new InvalidArgumentError("Origin must be a string or URL.");
    this.#origin = parseOrigin(origin);
  }

  [kDispatch](opts, handler) {
    return fetchDispatch(this.#origin, opts, handler, this[kPending]);
  }
}

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

class RetryAgent extends DispatcherBase {
  #agent;

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

// fetch with { dispatcher } routes through dispatcher.dispatch(); miniflare relies on this to reach workerd.
function fetchViaDispatcher(dispatcher, input, init) {
  let url: URL, method: any, headers: any, body: any, signal: any, redirect: any;
  // Input parsing failures reject the returned promise like WHATWG fetch, never throw synchronously.
  try {
    if (input instanceof Request) {
      url = new URL(input.url);
      method = init.method ?? input.method;
      headers = init.headers ?? input.headers;
      body = init.body ?? input.body;
      signal = init.signal ?? input.signal;
      redirect = init.redirect ?? input.redirect ?? "follow";
    } else {
      url = input instanceof URL ? input : new URL(String(input));
      method = init.method ?? "GET";
      headers = init.headers;
      body = init.body;
      signal = init.signal;
      redirect = init.redirect ?? "follow";
    }
    if (headers instanceof Headers) headers = headers.toJSON();
    method = method ? String(method) : "GET";
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
    // A pre-aborted signal rejects before the dispatcher is ever invoked, like WHATWG fetch.
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    let streamController: ReadableStreamDefaultController | null = null;
    let resumeData: (() => void) | null = null;
    let abortDispatch: ((reason?: Error) => void) | null = null;
    let onSignalAbort: (() => void) | null = null;
    const removeSignal = () => {
      if (!onSignalAbort) return;
      if (typeof signal.removeEventListener === "function") signal.removeEventListener("abort", onSignalAbort);
      else if (typeof signal.removeListener === "function") signal.removeListener("abort", onSignalAbort);
      onSignalAbort = null;
    };
    const routeError = err => {
      removeSignal();
      if (!resolved) {
        resolved = true;
        // Null so a late onData cannot park the dispatcher on the orphaned stream's backpressure.
        streamController = null;
        reject(err);
      } else if (streamController) {
        streamController.error(err);
        streamController = null;
      }
    };
    try {
      dispatcher.dispatch(
        {
          origin: url.origin,
          path: url.pathname + url.search,
          method,
          headers,
          body,
          maxRedirections: redirect === "follow" ? 20 : 0,
        },
        {
          onConnect: abort => {
            // A late onConnect after the promise settled must not re-register the signal listener.
            if (resolved) return;
            abortDispatch = abort;
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
            if (statusCode < 200) return true;
            // onHeaders after the promise settled violates the dispatch contract; keep the first outcome.
            if (resolved) return true;
            if (
              redirect === "error" &&
              (statusCode === 301 ||
                statusCode === 302 ||
                statusCode === 303 ||
                statusCode === 307 ||
                statusCode === 308)
            ) {
              const err = new TypeError(`Redirect response '${statusCode}' received when redirect mode is 'error'`);
              routeError(err);
              abortDispatch?.(err);
              return true;
            }
            resumeData = resume;
            const responseHeaders: [string, string][] = [];
            for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
              responseHeaders.push([String(rawHeaders[i]), String(rawHeaders[i + 1])]);
            }
            let responseBody: ReadableStream | null = null;
            const nullBody = statusCode === 204 || statusCode === 205 || statusCode === 304;
            if (!nullBody && method !== "HEAD") {
              responseBody = new ReadableStream({
                start(controller) {
                  streamController = controller;
                },
                pull() {
                  resumeData?.();
                },
                cancel(reason) {
                  removeSignal();
                  streamController = null;
                  abortDispatch?.(reason instanceof Error ? reason : undefined);
                },
              });
            }
            // Built before flipping resolved so a non-constructible status rejects; url/redirected stay unset (constructor limitation).
            const response = new Response(responseBody, { status: statusCode, statusText, headers: responseHeaders });
            resolved = true;
            resolve(response);
            return true;
          },
          onData: chunk => {
            if (!streamController) return true;
            // Copy: the dispatch contract only guarantees the chunk during the callback.
            streamController.enqueue(new Uint8Array(chunk));
            return (streamController.desiredSize ?? 1) > 0;
          },
          onComplete: () => {
            removeSignal();
            if (!resolved) {
              resolved = true;
              reject(
                new TypeError(
                  `fetch failed for ${url.origin}: the dispatcher completed without calling onHeaders; onHeaders must be called before onComplete`,
                ),
              );
              return;
            }
            streamController?.close();
            // Null so post-onComplete onData/onComplete become no-ops instead of throwing on a closed controller.
            streamController = null;
          },
          onError: routeError,
        },
      );
    } catch (err) {
      // A dispatcher that throws synchronously after resolving must error the body, not vanish into the executor.
      routeError(err);
    }
  });
}

function fetch(input, init) {
  // Raw module-local on purpose: nativeFetch stays the fast path until setGlobalDispatcher() installs one.
  const dispatcher = init?.dispatcher ?? globalDispatcher;
  if (dispatcher && typeof dispatcher.dispatch === "function") {
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
