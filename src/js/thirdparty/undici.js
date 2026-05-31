const EventEmitter = require("node:events");
const StreamModule = require("node:stream");
const { Readable, Duplex } = StreamModule;
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
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !reset,
  });

  const { status: statusCode, headers } = resp;

  // Throw if received 4xx or 5xx response indicating HTTP error
  if (throwOnError && statusCode >= 400 && statusCode < 600) {
    if (resp.body) await resp.body.cancel();
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

    if (inputBody && (effectiveMethod === "GET" || effectiveMethod === "HEAD")) {
      throw new Error("Body not allowed for GET or HEAD requests");
    }

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
        context,
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
// pipeline(url, opts, handler) -> Duplex
//   Writable side = request body; the handler receives the response and returns
//   a Readable whose output becomes the Duplex's readable side. Like request()/
//   stream(), the request body is buffered before dispatch.
function pipeline(url, opts = {}, handler) {
  if ($isCallable(opts)) {
    handler = opts;
    opts = {};
  }
  if (!$isCallable(handler)) {
    throw new InvalidArgumentError("invalid handler");
  }

  const method = (opts.method || "GET").toUpperCase();
  const reqChunks = [];
  let srcStream = null;
  let started = false;

  const duplex = new Duplex({
    read() {
      if (srcStream) srcStream.resume();
    },
    write(chunk, encoding, cb) {
      reqChunks.push($Buffer.isBuffer(chunk) ? chunk : $Buffer.from(chunk, encoding));
      cb();
    },
    final(cb) {
      run(reqChunks.length ? $Buffer.concat(reqChunks) : undefined).then(
        () => cb(),
        err => cb(err),
      );
    },
    destroy(err, cb) {
      if (srcStream && !srcStream.destroyed) srcStream.destroy(err || undefined);
      cb(err);
    },
  });

  async function run(reqBody) {
    if (started) return;
    started = true;

    let effectiveUrl = typeof url === "string" ? url : url instanceof URL ? url.href : _parseOrigin(url);
    if (opts.path) {
      effectiveUrl = new URL(opts.path, effectiveUrl).toString();
    }
    if (opts.query) {
      const parsed = new URL(effectiveUrl);
      const params = new URLSearchParams(parsed.search);
      for (const [key, value] of new URLSearchParams(opts.query)) params.set(key, value);
      parsed.search = params.toString();
      effectiveUrl = parsed.toString();
    }

    if (reqBody && (method === "GET" || method === "HEAD")) {
      throw new Error("Body not allowed for GET or HEAD requests");
    }

    const resp = await fetch(effectiveUrl, {
      method,
      headers: opts.headers || kEmptyObject,
      body: reqBody,
      signal: opts.signal || undefined,
      redirect: "manual",
      keepalive: !opts.reset,
    });

    const responseHeaders = resp.headers.toJSON();
    if (method !== "HEAD" && responseHeaders["content-encoding"]) {
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
    }

    if (opts.throwOnError && resp.status >= 400 && resp.status < 600) {
      if (resp.body) await resp.body.cancel();
      throw new Error(`Request failed with status code ${resp.status}`);
    }

    const body = resp.body ? new BodyReadable(resp) : Readable.from([]);
    srcStream = handler({
      statusCode: resp.status,
      headers: responseHeaders,
      opaque: opts.opaque,
      body,
      context: opts.context ?? kEmptyObject,
    });

    if (!srcStream || !$isCallable(srcStream.on)) {
      throw new InvalidReturnValueError("expected the handler to return a stream");
    }

    srcStream.on("data", chunk => {
      if (!duplex.push(chunk)) srcStream.pause();
    });
    srcStream.on("end", () => duplex.push(null));
    srcStream.on("error", err => duplex.destroy(err));
  }

  // Body-less methods dispatch immediately; methods with a body wait for the
  // writable side to finish so the buffered body can be sent.
  if (method === "GET" || method === "HEAD") {
    queueMicrotask(() => {
      run(undefined).catch(err => duplex.destroy(err));
    });
  }

  return duplex;
}

// Parse the TCP target for connect()/upgrade() from a string/URL/options object.
function _parseConnectTarget(input) {
  let origin;
  if (typeof input === "string") origin = input;
  else if (input instanceof URL) origin = input.href;
  else origin = input.origin ?? input.uri ?? input.url;
  const u = new URL(origin);
  const tls = u.protocol === "https:" || u.protocol === "wss:";
  return { tls, hostname: u.hostname, port: u.port ? Number(u.port) : tls ? 443 : 80, url: u };
}

// Open a raw TCP (or TLS) socket. Resolves once connected.
function _openSocket({ hostname, port, tls: useTls, servername, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RequestAbortedError("Request aborted"));
      return;
    }
    let socket;
    const connectEvent = useTls ? "secureConnect" : "connect";
    const cleanup = () => {
      if (!socket) return;
      socket.removeListener("error", onError);
      socket.removeListener(connectEvent, onConnect);
    };
    const onError = err => {
      cleanup();
      reject(err);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    if (useTls) {
      socket = require("node:tls").connect({ host: hostname, port, servername: servername || hostname });
    } else {
      socket = require("node:net").connect({ host: hostname, port });
    }
    socket.once(connectEvent, onConnect);
    socket.once("error", onError);
    if (signal) {
      signal.addEventListener?.("abort", () => socket.destroy(new RequestAbortedError("Request aborted")), {
        once: true,
      });
    }
  });
}

// Read and parse an HTTP/1.1 response head (status line + headers) off a raw
// socket. Returns { statusCode, statusLine, headers, leftover } and pauses the
// socket so the caller can take it over.
function _readResponseHead(socket, signal) {
  return new Promise((resolve, reject) => {
    let buf = $Buffer.alloc(0);
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onData = chunk => {
      buf = buf.length ? $Buffer.concat([buf, chunk]) : chunk;
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) {
        if (buf.length > 64 * 1024) {
          cleanup();
          reject(new HTTPParserError("Response head exceeded 64KB"));
        }
        return;
      }
      socket.pause();
      cleanup();
      const lines = buf.subarray(0, idx).toString("latin1").split("\r\n");
      const leftover = buf.subarray(idx + 4);
      const statusLine = lines[0] || "";
      const match = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(statusLine);
      const statusCode = match ? Number(match[1]) : 0;
      const headers = {};
      for (let i = 1; i < lines.length; i++) {
        const colon = lines[i].indexOf(":");
        if (colon === -1) continue;
        const key = lines[i].slice(0, colon).trim().toLowerCase();
        const value = lines[i].slice(colon + 1).trim();
        if (headers[key] === undefined) headers[key] = value;
        else if (Array.isArray(headers[key])) headers[key].push(value);
        else headers[key] = [headers[key], value];
      }
      resolve({ statusCode, statusLine, headers, leftover });
    };
    const onError = err => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new SocketError("Socket closed before the response head was received"));
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new RequestAbortedError("Request aborted"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener?.("abort", onAbort, { once: true });
    }
  });
}

// Bun does not auto-resume an explicitly paused socket when a "data"/"readable"
// listener is attached (Node does). Emulate that so the socket handed back by
// connect()/upgrade() starts flowing once the consumer begins reading.
function _resumeOnConsumer(socket) {
  const onNewListener = event => {
    if (event === "data" || event === "readable") {
      socket.removeListener("newListener", onNewListener);
      queueMicrotask(() => {
        if (!socket.destroyed) socket.resume();
      });
    }
  };
  socket.on("newListener", onNewListener);
}

// connect(options[, callback]) -> { statusCode, headers, socket, opaque }
//   HTTP CONNECT tunnel. `origin`/url is the TCP target; the CONNECT
//   request-target is `opts.path` (default host:port).
function connect(options, callback) {
  const promise = _doConnect(options);
  if ($isCallable(callback)) {
    promise.then(
      data => callback(null, data),
      err => callback(err, null),
    );
    return;
  }
  return promise;
}

async function _doConnect(options) {
  const target = _parseConnectTarget(options);
  const requestTarget =
    (typeof options === "object" && options !== null && options.path) || `${target.hostname}:${target.port}`;
  const socket = await _openSocket({
    hostname: target.hostname,
    port: target.port,
    tls: target.tls,
    servername: target.hostname,
    signal: options?.signal,
  });

  let head = `CONNECT ${requestTarget} HTTP/1.1\r\nHost: ${requestTarget}\r\n`;
  const headers = options?.headers || kEmptyObject;
  for (const key of Object.keys(headers)) head += `${key}: ${headers[key]}\r\n`;
  head += "\r\n";
  socket.write(head);

  const { statusCode, headers: resHeaders, leftover } = await _readResponseHead(socket, options?.signal);
  if (leftover && leftover.length) socket.unshift(leftover);
  _resumeOnConsumer(socket);
  return { statusCode, headers: resHeaders, socket, opaque: options?.opaque ?? kEmptyObject };
}

// upgrade(url[, options][, callback]) -> { headers, socket, opaque }
//   HTTP Upgrade handshake (expects 101 Switching Protocols).
function upgrade(url, options, callback) {
  if ($isCallable(options)) {
    callback = options;
    options = {};
  }
  const promise = _doUpgrade(url, options || {});
  if ($isCallable(callback)) {
    promise.then(
      data => callback(null, data),
      err => callback(err, null),
    );
    return;
  }
  return promise;
}

async function _doUpgrade(url, options) {
  const target = _parseConnectTarget(typeof url === "string" || url instanceof URL ? url : (options.origin ?? url));
  const path = options.path || target.url.pathname + target.url.search || "/";
  const method = (options.method || "GET").toUpperCase();
  const protocol = options.protocol || "websocket";
  const socket = await _openSocket({
    hostname: target.hostname,
    port: target.port,
    tls: target.tls,
    servername: target.hostname,
    signal: options.signal,
  });

  let head = `${method} ${path} HTTP/1.1\r\nHost: ${target.url.host}\r\nConnection: upgrade\r\nUpgrade: ${protocol}\r\n`;
  const headers = options.headers || kEmptyObject;
  for (const key of Object.keys(headers)) head += `${key}: ${headers[key]}\r\n`;
  head += "\r\n";
  socket.write(head);

  const { statusCode, headers: resHeaders, leftover } = await _readResponseHead(socket, options.signal);
  if (statusCode !== 101) {
    socket.destroy();
    throw new SocketError(`Upgrade request failed with status code ${statusCode}`);
  }
  if (leftover && leftover.length) socket.unshift(leftover);
  _resumeOnConsumer(socket);
  return { headers: resHeaders, socket, opaque: options.opaque ?? kEmptyObject };
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

  const maxRedirections = opts.maxRedirections;
  const followRedirects = maxRedirections != null && maxRedirections > 0;

  const resp = await fetch(url, {
    method,
    headers: inputHeaders,
    body: inputBody,
    signal,
    redirect: followRedirects ? "follow" : "manual",
    maxRedirects: followRedirects ? maxRedirections : undefined,
    keepalive: !opts.reset,
  });

  const { status: statusCode, headers } = resp;

  // Throw on HTTP error if requested
  if (opts.throwOnError && statusCode >= 400 && statusCode < 600) {
    if (resp.body) await resp.body.cancel();
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

  async request(opts, callback) {
    if (this.#closed) {
      const err = new ClientClosedError("The pool is closed");
      if ($isCallable(callback)) { callback(err, null); return; }
      throw err;
    }
    if ($isCallable(callback)) {
      _doRequest(this.#origin, opts).then(
        data => callback(null, data),
        err => callback(err, null),
      );
      return;
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

  async request(opts, callback) {
    if (this.#closed) {
      const err = new ClientClosedError("The client is closed");
      if ($isCallable(callback)) { callback(err, null); return; }
      throw err;
    }
    if ($isCallable(callback)) {
      _doRequest(this.#origin, opts).then(
        data => callback(null, data),
        err => callback(err, null),
      );
      return;
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
