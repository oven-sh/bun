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

// Cache store validation helpers
function assertCacheKey(key) {
  if (typeof key !== "object") {
    throw new TypeError(`expected key to be object, got ${typeof key}`);
  }
  for (const property of ["origin", "method", "path"]) {
    if (typeof key[property] !== "string") {
      throw new TypeError(`expected key.${property} to be string, got ${typeof key[property]}`);
    }
  }
  if (key.headers !== undefined && typeof key.headers !== "object") {
    throw new TypeError(`expected headers to be object, got ${typeof key.headers}`);
  }
}

function assertCacheValue(value) {
  if (typeof value !== "object") {
    throw new TypeError(`expected value to be object, got ${typeof value}`);
  }
  for (const property of ["statusCode", "cachedAt", "staleAt", "deleteAt"]) {
    if (typeof value[property] !== "number") {
      throw new TypeError(`expected value.${property} to be number, got ${typeof value[property]}`);
    }
  }
  if (typeof value.statusMessage !== "string") {
    throw new TypeError(`expected value.statusMessage to be string, got ${typeof value.statusMessage}`);
  }
  if (value.headers != null && typeof value.headers !== "object") {
    throw new TypeError(`expected value.headers to be object, got ${typeof value.headers}`);
  }
  if (value.vary !== undefined && typeof value.vary !== "object") {
    throw new TypeError(`expected value.vary to be object, got ${typeof value.vary}`);
  }
  if (value.etag !== undefined && typeof value.etag !== "string") {
    throw new TypeError(`expected value.etag to be string, got ${typeof value.etag}`);
  }
}

function findCacheEntry(key, entries, now) {
  return entries.find(
    entry =>
      entry.deleteAt > now &&
      entry.method === key.method &&
      (entry.vary == null ||
        Object.keys(entry.vary).every(headerName => {
          if (entry.vary[headerName] === null) {
            return key.headers[headerName] === undefined;
          }
          return entry.vary[headerName] === key.headers[headerName];
        })),
  );
}

class MemoryCacheStore extends EventEmitter {
  #maxCount = 1024;
  #maxSize = 104857600; // 100MB
  #maxEntrySize = 5242880; // 5MB

  #size = 0;
  #count = 0;
  #entries = new Map();
  #hasEmittedMaxSizeEvent = false;

  constructor(opts) {
    super();
    if (opts) {
      if (typeof opts !== "object") {
        throw new TypeError("MemoryCacheStore options must be an object");
      }
      if (opts.maxCount !== undefined) {
        if (typeof opts.maxCount !== "number" || !Number.isInteger(opts.maxCount) || opts.maxCount < 0) {
          throw new TypeError("MemoryCacheStore options.maxCount must be a non-negative integer");
        }
        this.#maxCount = opts.maxCount;
      }
      if (opts.maxSize !== undefined) {
        if (typeof opts.maxSize !== "number" || !Number.isInteger(opts.maxSize) || opts.maxSize < 0) {
          throw new TypeError("MemoryCacheStore options.maxSize must be a non-negative integer");
        }
        this.#maxSize = opts.maxSize;
      }
      if (opts.maxEntrySize !== undefined) {
        if (typeof opts.maxEntrySize !== "number" || !Number.isInteger(opts.maxEntrySize) || opts.maxEntrySize < 0) {
          throw new TypeError("MemoryCacheStore options.maxEntrySize must be a non-negative integer");
        }
        this.#maxEntrySize = opts.maxEntrySize;
      }
    }
  }

  get size() {
    return this.#size;
  }

  isFull() {
    return this.#size >= this.#maxSize || this.#count >= this.#maxCount;
  }

  get(key) {
    assertCacheKey(key);
    const topLevelKey = `${key.origin}:${key.path}`;
    const now = Date.now();
    const entries = this.#entries.get(topLevelKey);
    const entry = entries ? findCacheEntry(key, entries, now) : null;
    return entry == null
      ? undefined
      : {
          statusMessage: entry.statusMessage,
          statusCode: entry.statusCode,
          headers: entry.headers,
          body: entry.body,
          vary: entry.vary ? entry.vary : undefined,
          etag: entry.etag,
          cacheControlDirectives: entry.cacheControlDirectives,
          cachedAt: entry.cachedAt,
          staleAt: entry.staleAt,
          deleteAt: entry.deleteAt,
        };
  }

  createWriteStream(key, val) {
    assertCacheKey(key);
    assertCacheValue(val);
    const topLevelKey = `${key.origin}:${key.path}`;
    const store = this;
    const entry = { ...key, ...val, body: [], size: 0 };
    const { Writable } = StreamModule;
    return new Writable({
      write(chunk, encoding, callback) {
        if (typeof chunk === "string") {
          chunk = Buffer.from(chunk, encoding);
        }
        entry.size += chunk.byteLength;
        if (entry.size >= store.#maxEntrySize) {
          this.destroy();
        } else {
          entry.body.push(chunk);
        }
        callback(null);
      },
      final(callback) {
        let entries = store.#entries.get(topLevelKey);
        if (!entries) {
          entries = [];
          store.#entries.set(topLevelKey, entries);
        }
        const previousEntry = findCacheEntry(key, entries, Date.now());
        if (previousEntry) {
          const index = entries.indexOf(previousEntry);
          entries.splice(index, 1, entry);
          store.#size -= previousEntry.size;
        } else {
          entries.push(entry);
          store.#count += 1;
        }
        store.#size += entry.size;
        if (store.#size > store.#maxSize || store.#count > store.#maxCount) {
          if (!store.#hasEmittedMaxSizeEvent) {
            store.emit("maxSizeExceeded", {
              size: store.#size,
              maxSize: store.#maxSize,
              count: store.#count,
              maxCount: store.#maxCount,
            });
            store.#hasEmittedMaxSizeEvent = true;
          }
          for (const [key, entries] of store.#entries) {
            for (const entry of entries.splice(0, entries.length / 2)) {
              store.#size -= entry.size;
              store.#count -= 1;
            }
            if (entries.length === 0) {
              store.#entries.delete(key);
            }
          }
          if (store.#size < store.#maxSize && store.#count < store.#maxCount) {
            store.#hasEmittedMaxSizeEvent = false;
          }
        }
        callback(null);
      },
    });
  }

  delete(key) {
    if (typeof key !== "object") {
      throw new TypeError(`expected key to be object, got ${typeof key}`);
    }
    const topLevelKey = `${key.origin}:${key.path}`;
    for (const entry of this.#entries.get(topLevelKey) ?? []) {
      this.#size -= entry.size;
      this.#count -= 1;
    }
    this.#entries.delete(topLevelKey);
  }
}

const SQLITE_MAX_ENTRY_SIZE = 2 * 1000 * 1000 * 1000; // 2GB
const SQLITE_VERSION = 3;

function headerValueEquals(lhs, rhs) {
  if (lhs == null && rhs == null) {
    return true;
  }
  if ((lhs == null && rhs != null) || (lhs != null && rhs == null)) {
    return false;
  }
  if (Array.isArray(lhs) && Array.isArray(rhs)) {
    if (lhs.length !== rhs.length) {
      return false;
    }
    return lhs.every((x, i) => x === rhs[i]);
  }
  return lhs === rhs;
}

class SqliteCacheStore {
  #maxEntrySize = SQLITE_MAX_ENTRY_SIZE;
  #maxCount = Infinity;
  #db;
  #getValuesQuery;
  #updateValueQuery;
  #insertValueQuery;
  #deleteExpiredValuesQuery;
  #deleteByUrlQuery;
  #countEntriesQuery;
  #deleteOldValuesQuery;

  constructor(opts) {
    if (opts) {
      if (typeof opts !== "object") {
        throw new TypeError("SqliteCacheStore options must be an object");
      }
      if (opts.maxEntrySize !== undefined) {
        if (typeof opts.maxEntrySize !== "number" || !Number.isInteger(opts.maxEntrySize) || opts.maxEntrySize < 0) {
          throw new TypeError("SqliteCacheStore options.maxEntrySize must be a non-negative integer");
        }
        if (opts.maxEntrySize > SQLITE_MAX_ENTRY_SIZE) {
          throw new TypeError("SqliteCacheStore options.maxEntrySize must be less than 2gb");
        }
        this.#maxEntrySize = opts.maxEntrySize;
      }
      if (opts.maxCount !== undefined) {
        if (typeof opts.maxCount !== "number" || !Number.isInteger(opts.maxCount) || opts.maxCount < 0) {
          throw new TypeError("SqliteCacheStore options.maxCount must be a non-negative integer");
        }
        this.#maxCount = opts.maxCount;
      }
    }

    const { Database } = require("../bun/sqlite.ts");
    this.#db = new Database(opts?.location ?? ":memory:");

    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = memory;

      CREATE TABLE IF NOT EXISTS cacheInterceptorV${SQLITE_VERSION} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        method TEXT NOT NULL,
        body BLOB NULL,
        deleteAt INTEGER NOT NULL,
        statusCode INTEGER NOT NULL,
        statusMessage TEXT NOT NULL,
        headers TEXT NULL,
        cacheControlDirectives TEXT NULL,
        etag TEXT NULL,
        vary TEXT NULL,
        cachedAt INTEGER NOT NULL,
        staleAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cacheInterceptorV${SQLITE_VERSION}_getValuesQuery ON cacheInterceptorV${SQLITE_VERSION}(url, method, deleteAt);
      CREATE INDEX IF NOT EXISTS idx_cacheInterceptorV${SQLITE_VERSION}_deleteByUrlQuery ON cacheInterceptorV${SQLITE_VERSION}(deleteAt);
    `);

    this.#getValuesQuery = this.#db.prepare(`
      SELECT id, body, deleteAt, statusCode, statusMessage, headers, etag, cacheControlDirectives, vary, cachedAt, staleAt
      FROM cacheInterceptorV${SQLITE_VERSION}
      WHERE url = ? AND method = ?
      ORDER BY deleteAt ASC
    `);

    this.#updateValueQuery = this.#db.prepare(`
      UPDATE cacheInterceptorV${SQLITE_VERSION} SET
        body = ?, deleteAt = ?, statusCode = ?, statusMessage = ?, headers = ?, etag = ?, cacheControlDirectives = ?, cachedAt = ?, staleAt = ?
      WHERE id = ?
    `);

    this.#insertValueQuery = this.#db.prepare(`
      INSERT INTO cacheInterceptorV${SQLITE_VERSION} (url, method, body, deleteAt, statusCode, statusMessage, headers, etag, cacheControlDirectives, vary, cachedAt, staleAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.#deleteByUrlQuery = this.#db.prepare(`DELETE FROM cacheInterceptorV${SQLITE_VERSION} WHERE url = ?`);
    this.#countEntriesQuery = this.#db.prepare(`SELECT COUNT(*) AS total FROM cacheInterceptorV${SQLITE_VERSION}`);
    this.#deleteExpiredValuesQuery = this.#db.prepare(
      `DELETE FROM cacheInterceptorV${SQLITE_VERSION} WHERE deleteAt <= ?`,
    );
    this.#deleteOldValuesQuery =
      this.#maxCount === Infinity
        ? null
        : this.#db.prepare(`
        DELETE FROM cacheInterceptorV${SQLITE_VERSION}
        WHERE id IN (
          SELECT id FROM cacheInterceptorV${SQLITE_VERSION} ORDER BY cachedAt DESC LIMIT ?
        )
      `);
  }

  close() {
    this.#db.close();
  }

  get(key) {
    assertCacheKey(key);
    const value = this.#findValue(key);
    return value
      ? {
          body: value.body ? Buffer.from(value.body) : undefined,
          statusCode: value.statusCode,
          statusMessage: value.statusMessage,
          headers: value.headers ? JSON.parse(value.headers) : undefined,
          etag: value.etag ? value.etag : undefined,
          vary: value.vary ? JSON.parse(value.vary) : undefined,
          cacheControlDirectives: value.cacheControlDirectives ? JSON.parse(value.cacheControlDirectives) : undefined,
          cachedAt: value.cachedAt,
          staleAt: value.staleAt,
          deleteAt: value.deleteAt,
        }
      : undefined;
  }

  set(key, value) {
    assertCacheKey(key);
    const url = this.#makeValueUrl(key);
    const body = Array.isArray(value.body) ? Buffer.concat(value.body) : value.body;
    const size = body?.byteLength;
    if (size && size > this.#maxEntrySize) {
      return;
    }
    const existingValue = this.#findValue(key, true);
    if (existingValue) {
      this.#updateValueQuery.run(
        body,
        value.deleteAt,
        value.statusCode,
        value.statusMessage,
        value.headers ? JSON.stringify(value.headers) : null,
        value.etag ? value.etag : null,
        value.cacheControlDirectives ? JSON.stringify(value.cacheControlDirectives) : null,
        value.cachedAt,
        value.staleAt,
        existingValue.id,
      );
    } else {
      this.#prune();
      this.#insertValueQuery.run(
        url,
        key.method,
        body,
        value.deleteAt,
        value.statusCode,
        value.statusMessage,
        value.headers ? JSON.stringify(value.headers) : null,
        value.etag ? value.etag : null,
        value.cacheControlDirectives ? JSON.stringify(value.cacheControlDirectives) : null,
        value.vary ? JSON.stringify(value.vary) : null,
        value.cachedAt,
        value.staleAt,
      );
    }
  }

  createWriteStream(key, value) {
    assertCacheKey(key);
    assertCacheValue(value);
    let size = 0;
    const body = [];
    const store = this;
    const { Writable } = StreamModule;
    return new Writable({
      decodeStrings: true,
      write(chunk, encoding, callback) {
        size += chunk.byteLength;
        if (size < store.#maxEntrySize) {
          body.push(chunk);
        } else {
          this.destroy();
        }
        callback();
      },
      final(callback) {
        store.set(key, { ...value, body });
        callback();
      },
    });
  }

  delete(key) {
    if (typeof key !== "object") {
      throw new TypeError(`expected key to be object, got ${typeof key}`);
    }
    this.#deleteByUrlQuery.run(this.#makeValueUrl(key));
  }

  #prune() {
    if (Number.isFinite(this.#maxCount) && this.size <= this.#maxCount) {
      return 0;
    }
    const removed = this.#deleteExpiredValuesQuery.run(Date.now()).changes;
    if (removed) {
      return removed;
    }
    const removedOld = this.#deleteOldValuesQuery?.run(Math.max(Math.floor(this.#maxCount * 0.1), 1)).changes;
    if (removedOld) {
      return removedOld;
    }
    return 0;
  }

  get size() {
    const { total } = this.#countEntriesQuery.get();
    return total;
  }

  #makeValueUrl(key) {
    return `${key.origin}/${key.path}`;
  }

  #findValue(key, canBeExpired = false) {
    const url = this.#makeValueUrl(key);
    const { headers, method } = key;
    const values = this.#getValuesQuery.all(url, method);
    if (values.length === 0) {
      return undefined;
    }
    const now = Date.now();
    for (const value of values) {
      if (now >= value.deleteAt && !canBeExpired) {
        return undefined;
      }
      let matches = true;
      if (value.vary) {
        const vary = JSON.parse(value.vary);
        for (const header in vary) {
          if (!headerValueEquals(headers[header], vary[header])) {
            matches = false;
            break;
          }
        }
      }
      if (matches) {
        return value;
      }
    }
    return undefined;
  }
}

const cacheStores = {
  MemoryCacheStore,
  SqliteCacheStore,
};

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
  cacheStores,
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
