// Hardcoded module "node:http2"
// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("$shared");

const tls = require("node:tls");
const net = require("node:net");
type Socket = typeof net.Socket;
const TLSSocket = tls.TLSSocket;
const EventEmitter = require("node:events");
const { Duplex } = require("node:stream");
const { H2FrameParser } = $lazy("internal/http2");
const sensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");
const bunHTTP2Native = Symbol.for("::bunhttp2native::");
const bunHTTP2StreamResponded = Symbol.for("::bunhttp2hasResponded::");
const bunHTTP2StreamReadQueue = Symbol.for("::bunhttp2ReadQueue::");
const bunHTTP2Closed = Symbol.for("::bunhttp2closed::");
const bunHTTP2Socket = Symbol.for("::bunhttp2socket::");

const ReflectGetPrototypeOf = Reflect.getPrototypeOf;
const FunctionPrototypeBind = Function.prototype.call.bind(Function.prototype.bind);

const proxySocketHandler = {
  get(session, prop) {
    switch (prop) {
      case "setTimeout":
      case "ref":
      case "unref":
        return FunctionPrototypeBind(session[prop], session);
      case "destroy":
      case "emit":
      case "end":
      case "pause":
      case "read":
      case "resume":
      case "write":
      case "setEncoding":
      case "setKeepAlive":
      case "setNoDelay":
        const error = new Error(
          "ERR_HTTP2_NO_SOCKET_MANIPULATION: HTTP/2 sockets should not be directly manipulated (e.g. read and written)",
        );
        error.code = "ERR_HTTP2_NO_SOCKET_MANIPULATION";
        throw error;
      default: {
        const socket = session[bunHTTP2Socket];
        if (!socket) {
          const error = new Error("ERR_HTTP2_SOCKET_UNBOUND: The socket has been disconnected from the Http2Session");
          error.code = "ERR_HTTP2_SOCKET_UNBOUND";
          throw error;
        }
        const value = socket[prop];
        return typeof value === "function" ? FunctionPrototypeBind(value, socket) : value;
      }
    }
  },
  getPrototypeOf(session) {
    const socket = session[bunHTTP2Socket];
    if (!socket) {
      const error = new Error("ERR_HTTP2_SOCKET_UNBOUND: The socket has been disconnected from the Http2Session");
      error.code = "ERR_HTTP2_SOCKET_UNBOUND";
      throw error;
    }
    return ReflectGetPrototypeOf(socket);
  },
  set(session, prop, value) {
    switch (prop) {
      case "setTimeout":
      case "ref":
      case "unref":
        session[prop] = value;
        return true;
      case "destroy":
      case "emit":
      case "end":
      case "pause":
      case "read":
      case "resume":
      case "write":
      case "setEncoding":
      case "setKeepAlive":
      case "setNoDelay":
        const error = new Error(
          "ERR_HTTP2_NO_SOCKET_MANIPULATION: HTTP/2 sockets should not be directly manipulated (e.g. read and written)",
        );
        error.code = "ERR_HTTP2_NO_SOCKET_MANIPULATION";
        throw error;
      default: {
        const socket = session[bunHTTP2Socket];
        if (!socket) {
          const error = new Error("ERR_HTTP2_SOCKET_UNBOUND: The socket has been disconnected from the Http2Session");
          error.code = "ERR_HTTP2_SOCKET_UNBOUND";
          throw error;
        }
        socket[prop] = value;
        return true;
      }
    }
  },
};

const constants = {
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522,
  NGHTTP2_SESSION_SERVER: 0,
  NGHTTP2_SESSION_CLIENT: 1,
  NGHTTP2_STREAM_STATE_IDLE: 1,
  NGHTTP2_STREAM_STATE_OPEN: 2,
  NGHTTP2_STREAM_STATE_RESERVED_LOCAL: 3,
  NGHTTP2_STREAM_STATE_RESERVED_REMOTE: 4,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL: 5,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE: 6,
  NGHTTP2_STREAM_STATE_CLOSED: 7,
  NGHTTP2_FLAG_NONE: 0,
  NGHTTP2_FLAG_END_STREAM: 1,
  NGHTTP2_FLAG_END_HEADERS: 4,
  NGHTTP2_FLAG_ACK: 1,
  NGHTTP2_FLAG_PADDED: 8,
  NGHTTP2_FLAG_PRIORITY: 32,
  DEFAULT_SETTINGS_HEADER_TABLE_SIZE: 4096,
  DEFAULT_SETTINGS_ENABLE_PUSH: 1,
  DEFAULT_SETTINGS_MAX_CONCURRENT_STREAMS: 4294967295,
  DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE: 65535,
  DEFAULT_SETTINGS_MAX_FRAME_SIZE: 16384,
  DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE: 65535,
  DEFAULT_SETTINGS_ENABLE_CONNECT_PROTOCOL: 0,
  MAX_MAX_FRAME_SIZE: 16777215,
  MIN_MAX_FRAME_SIZE: 16384,
  MAX_INITIAL_WINDOW_SIZE: 2147483647,
  NGHTTP2_SETTINGS_HEADER_TABLE_SIZE: 1,
  NGHTTP2_SETTINGS_ENABLE_PUSH: 2,
  NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS: 3,
  NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE: 4,
  NGHTTP2_SETTINGS_MAX_FRAME_SIZE: 5,
  NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE: 6,
  NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL: 8,
  PADDING_STRATEGY_NONE: 0,
  PADDING_STRATEGY_ALIGNED: 1,
  PADDING_STRATEGY_MAX: 2,
  PADDING_STRATEGY_CALLBACK: 1,
  NGHTTP2_NO_ERROR: 0,
  NGHTTP2_PROTOCOL_ERROR: 1,
  NGHTTP2_INTERNAL_ERROR: 2,
  NGHTTP2_FLOW_CONTROL_ERROR: 3,
  NGHTTP2_SETTINGS_TIMEOUT: 4,
  NGHTTP2_STREAM_CLOSED: 5,
  NGHTTP2_FRAME_SIZE_ERROR: 6,
  NGHTTP2_REFUSED_STREAM: 7,
  NGHTTP2_CANCEL: 8,
  NGHTTP2_COMPRESSION_ERROR: 9,
  NGHTTP2_CONNECT_ERROR: 10,
  NGHTTP2_ENHANCE_YOUR_CALM: 11,
  NGHTTP2_INADEQUATE_SECURITY: 12,
  NGHTTP2_HTTP_1_1_REQUIRED: 13,
  NGHTTP2_DEFAULT_WEIGHT: 16,
  HTTP2_HEADER_STATUS: ":status",
  HTTP2_HEADER_METHOD: ":method",
  HTTP2_HEADER_AUTHORITY: ":authority",
  HTTP2_HEADER_SCHEME: ":scheme",
  HTTP2_HEADER_PATH: ":path",
  HTTP2_HEADER_PROTOCOL: ":protocol",
  HTTP2_HEADER_ACCEPT_ENCODING: "accept-encoding",
  HTTP2_HEADER_ACCEPT_LANGUAGE: "accept-language",
  HTTP2_HEADER_ACCEPT_RANGES: "accept-ranges",
  HTTP2_HEADER_ACCEPT: "accept",
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS: "access-control-allow-credentials",
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS: "access-control-allow-headers",
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS: "access-control-allow-methods",
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN: "access-control-allow-origin",
  HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS: "access-control-expose-headers",
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS: "access-control-request-headers",
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD: "access-control-request-method",
  HTTP2_HEADER_AGE: "age",
  HTTP2_HEADER_AUTHORIZATION: "authorization",
  HTTP2_HEADER_CACHE_CONTROL: "cache-control",
  HTTP2_HEADER_CONNECTION: "connection",
  HTTP2_HEADER_CONTENT_DISPOSITION: "content-disposition",
  HTTP2_HEADER_CONTENT_ENCODING: "content-encoding",
  HTTP2_HEADER_CONTENT_LENGTH: "content-length",
  HTTP2_HEADER_CONTENT_TYPE: "content-type",
  HTTP2_HEADER_COOKIE: "cookie",
  HTTP2_HEADER_DATE: "date",
  HTTP2_HEADER_ETAG: "etag",
  HTTP2_HEADER_FORWARDED: "forwarded",
  HTTP2_HEADER_HOST: "host",
  HTTP2_HEADER_IF_MODIFIED_SINCE: "if-modified-since",
  HTTP2_HEADER_IF_NONE_MATCH: "if-none-match",
  HTTP2_HEADER_IF_RANGE: "if-range",
  HTTP2_HEADER_LAST_MODIFIED: "last-modified",
  HTTP2_HEADER_LINK: "link",
  HTTP2_HEADER_LOCATION: "location",
  HTTP2_HEADER_RANGE: "range",
  HTTP2_HEADER_REFERER: "referer",
  HTTP2_HEADER_SERVER: "server",
  HTTP2_HEADER_SET_COOKIE: "set-cookie",
  HTTP2_HEADER_STRICT_TRANSPORT_SECURITY: "strict-transport-security",
  HTTP2_HEADER_TRANSFER_ENCODING: "transfer-encoding",
  HTTP2_HEADER_TE: "te",
  HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS: "upgrade-insecure-requests",
  HTTP2_HEADER_UPGRADE: "upgrade",
  HTTP2_HEADER_USER_AGENT: "user-agent",
  HTTP2_HEADER_VARY: "vary",
  HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS: "x-content-type-options",
  HTTP2_HEADER_X_FRAME_OPTIONS: "x-frame-options",
  HTTP2_HEADER_KEEP_ALIVE: "keep-alive",
  HTTP2_HEADER_PROXY_CONNECTION: "proxy-connection",
  HTTP2_HEADER_X_XSS_PROTECTION: "x-xss-protection",
  HTTP2_HEADER_ALT_SVC: "alt-svc",
  HTTP2_HEADER_CONTENT_SECURITY_POLICY: "content-security-policy",
  HTTP2_HEADER_EARLY_DATA: "early-data",
  HTTP2_HEADER_EXPECT_CT: "expect-ct",
  HTTP2_HEADER_ORIGIN: "origin",
  HTTP2_HEADER_PURPOSE: "purpose",
  HTTP2_HEADER_TIMING_ALLOW_ORIGIN: "timing-allow-origin",
  HTTP2_HEADER_X_FORWARDED_FOR: "x-forwarded-for",
  HTTP2_HEADER_PRIORITY: "priority",
  HTTP2_HEADER_ACCEPT_CHARSET: "accept-charset",
  HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE: "access-control-max-age",
  HTTP2_HEADER_ALLOW: "allow",
  HTTP2_HEADER_CONTENT_LANGUAGE: "content-language",
  HTTP2_HEADER_CONTENT_LOCATION: "content-location",
  HTTP2_HEADER_CONTENT_MD5: "content-md5",
  HTTP2_HEADER_CONTENT_RANGE: "content-range",
  HTTP2_HEADER_DNT: "dnt",
  HTTP2_HEADER_EXPECT: "expect",
  HTTP2_HEADER_EXPIRES: "expires",
  HTTP2_HEADER_FROM: "from",
  HTTP2_HEADER_IF_MATCH: "if-match",
  HTTP2_HEADER_IF_UNMODIFIED_SINCE: "if-unmodified-since",
  HTTP2_HEADER_MAX_FORWARDS: "max-forwards",
  HTTP2_HEADER_PREFER: "prefer",
  HTTP2_HEADER_PROXY_AUTHENTICATE: "proxy-authenticate",
  HTTP2_HEADER_PROXY_AUTHORIZATION: "proxy-authorization",
  HTTP2_HEADER_REFRESH: "refresh",
  HTTP2_HEADER_RETRY_AFTER: "retry-after",
  HTTP2_HEADER_TRAILER: "trailer",
  HTTP2_HEADER_TK: "tk",
  HTTP2_HEADER_VIA: "via",
  HTTP2_HEADER_WARNING: "warning",
  HTTP2_HEADER_WWW_AUTHENTICATE: "www-authenticate",
  HTTP2_HEADER_HTTP2_SETTINGS: "http2-settings",
  HTTP2_METHOD_ACL: "ACL",
  HTTP2_METHOD_BASELINE_CONTROL: "BASELINE-CONTROL",
  HTTP2_METHOD_BIND: "BIND",
  HTTP2_METHOD_CHECKIN: "CHECKIN",
  HTTP2_METHOD_CHECKOUT: "CHECKOUT",
  HTTP2_METHOD_CONNECT: "CONNECT",
  HTTP2_METHOD_COPY: "COPY",
  HTTP2_METHOD_DELETE: "DELETE",
  HTTP2_METHOD_GET: "GET",
  HTTP2_METHOD_HEAD: "HEAD",
  HTTP2_METHOD_LABEL: "LABEL",
  HTTP2_METHOD_LINK: "LINK",
  HTTP2_METHOD_LOCK: "LOCK",
  HTTP2_METHOD_MERGE: "MERGE",
  HTTP2_METHOD_MKACTIVITY: "MKACTIVITY",
  HTTP2_METHOD_MKCALENDAR: "MKCALENDAR",
  HTTP2_METHOD_MKCOL: "MKCOL",
  HTTP2_METHOD_MKREDIRECTREF: "MKREDIRECTREF",
  HTTP2_METHOD_MKWORKSPACE: "MKWORKSPACE",
  HTTP2_METHOD_MOVE: "MOVE",
  HTTP2_METHOD_OPTIONS: "OPTIONS",
  HTTP2_METHOD_ORDERPATCH: "ORDERPATCH",
  HTTP2_METHOD_PATCH: "PATCH",
  HTTP2_METHOD_POST: "POST",
  HTTP2_METHOD_PRI: "PRI",
  HTTP2_METHOD_PROPFIND: "PROPFIND",
  HTTP2_METHOD_PROPPATCH: "PROPPATCH",
  HTTP2_METHOD_PUT: "PUT",
  HTTP2_METHOD_REBIND: "REBIND",
  HTTP2_METHOD_REPORT: "REPORT",
  HTTP2_METHOD_SEARCH: "SEARCH",
  HTTP2_METHOD_TRACE: "TRACE",
  HTTP2_METHOD_UNBIND: "UNBIND",
  HTTP2_METHOD_UNCHECKOUT: "UNCHECKOUT",
  HTTP2_METHOD_UNLINK: "UNLINK",
  HTTP2_METHOD_UNLOCK: "UNLOCK",
  HTTP2_METHOD_UPDATE: "UPDATE",
  HTTP2_METHOD_UPDATEREDIRECTREF: "UPDATEREDIRECTREF",
  HTTP2_METHOD_VERSION_CONTROL: "VERSION-CONTROL",
  HTTP_STATUS_CONTINUE: 100,
  HTTP_STATUS_SWITCHING_PROTOCOLS: 101,
  HTTP_STATUS_PROCESSING: 102,
  HTTP_STATUS_EARLY_HINTS: 103,
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_CREATED: 201,
  HTTP_STATUS_ACCEPTED: 202,
  HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION: 203,
  HTTP_STATUS_NO_CONTENT: 204,
  HTTP_STATUS_RESET_CONTENT: 205,
  HTTP_STATUS_PARTIAL_CONTENT: 206,
  HTTP_STATUS_MULTI_STATUS: 207,
  HTTP_STATUS_ALREADY_REPORTED: 208,
  HTTP_STATUS_IM_USED: 226,
  HTTP_STATUS_MULTIPLE_CHOICES: 300,
  HTTP_STATUS_MOVED_PERMANENTLY: 301,
  HTTP_STATUS_FOUND: 302,
  HTTP_STATUS_SEE_OTHER: 303,
  HTTP_STATUS_NOT_MODIFIED: 304,
  HTTP_STATUS_USE_PROXY: 305,
  HTTP_STATUS_TEMPORARY_REDIRECT: 307,
  HTTP_STATUS_PERMANENT_REDIRECT: 308,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_PAYMENT_REQUIRED: 402,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_METHOD_NOT_ALLOWED: 405,
  HTTP_STATUS_NOT_ACCEPTABLE: 406,
  HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED: 407,
  HTTP_STATUS_REQUEST_TIMEOUT: 408,
  HTTP_STATUS_CONFLICT: 409,
  HTTP_STATUS_GONE: 410,
  HTTP_STATUS_LENGTH_REQUIRED: 411,
  HTTP_STATUS_PRECONDITION_FAILED: 412,
  HTTP_STATUS_PAYLOAD_TOO_LARGE: 413,
  HTTP_STATUS_URI_TOO_LONG: 414,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE: 415,
  HTTP_STATUS_RANGE_NOT_SATISFIABLE: 416,
  HTTP_STATUS_EXPECTATION_FAILED: 417,
  HTTP_STATUS_TEAPOT: 418,
  HTTP_STATUS_MISDIRECTED_REQUEST: 421,
  HTTP_STATUS_UNPROCESSABLE_ENTITY: 422,
  HTTP_STATUS_LOCKED: 423,
  HTTP_STATUS_FAILED_DEPENDENCY: 424,
  HTTP_STATUS_TOO_EARLY: 425,
  HTTP_STATUS_UPGRADE_REQUIRED: 426,
  HTTP_STATUS_PRECONDITION_REQUIRED: 428,
  HTTP_STATUS_TOO_MANY_REQUESTS: 429,
  HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_NOT_IMPLEMENTED: 501,
  HTTP_STATUS_BAD_GATEWAY: 502,
  HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  HTTP_STATUS_GATEWAY_TIMEOUT: 504,
  HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED: 505,
  HTTP_STATUS_VARIANT_ALSO_NEGOTIATES: 506,
  HTTP_STATUS_INSUFFICIENT_STORAGE: 507,
  HTTP_STATUS_LOOP_DETECTED: 508,
  HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED: 509,
  HTTP_STATUS_NOT_EXTENDED: 510,
  HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED: 511,
};

const NoPayloadMethods = new Set([
  constants.HTTP2_METHOD_DELETE,
  constants.HTTP2_METHOD_GET,
  constants.HTTP2_METHOD_HEAD,
]);

const ValidPseudoHeaders = new Set([
  constants.HTTP2_HEADER_STATUS,
  constants.HTTP2_HEADER_METHOD,
  constants.HTTP2_HEADER_AUTHORITY,
  constants.HTTP2_HEADER_SCHEME,
  constants.HTTP2_HEADER_PATH,
  constants.HTTP2_HEADER_PROTOCOL,
]);

const SingleValueHeaders = new Set([
  constants.HTTP2_HEADER_STATUS,
  constants.HTTP2_HEADER_METHOD,
  constants.HTTP2_HEADER_AUTHORITY,
  constants.HTTP2_HEADER_SCHEME,
  constants.HTTP2_HEADER_PATH,
  constants.HTTP2_HEADER_PROTOCOL,
  constants.HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS,
  constants.HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE,
  constants.HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD,
  constants.HTTP2_HEADER_AGE,
  constants.HTTP2_HEADER_AUTHORIZATION,
  constants.HTTP2_HEADER_CONTENT_ENCODING,
  constants.HTTP2_HEADER_CONTENT_LANGUAGE,
  constants.HTTP2_HEADER_CONTENT_LENGTH,
  constants.HTTP2_HEADER_CONTENT_LOCATION,
  constants.HTTP2_HEADER_CONTENT_MD5,
  constants.HTTP2_HEADER_CONTENT_RANGE,
  constants.HTTP2_HEADER_CONTENT_TYPE,
  constants.HTTP2_HEADER_DATE,
  constants.HTTP2_HEADER_DNT,
  constants.HTTP2_HEADER_ETAG,
  constants.HTTP2_HEADER_EXPIRES,
  constants.HTTP2_HEADER_FROM,
  constants.HTTP2_HEADER_HOST,
  constants.HTTP2_HEADER_IF_MATCH,
  constants.HTTP2_HEADER_IF_MODIFIED_SINCE,
  constants.HTTP2_HEADER_IF_NONE_MATCH,
  constants.HTTP2_HEADER_IF_RANGE,
  constants.HTTP2_HEADER_IF_UNMODIFIED_SINCE,
  constants.HTTP2_HEADER_LAST_MODIFIED,
  constants.HTTP2_HEADER_LOCATION,
  constants.HTTP2_HEADER_MAX_FORWARDS,
  constants.HTTP2_HEADER_PROXY_AUTHORIZATION,
  constants.HTTP2_HEADER_RANGE,
  constants.HTTP2_HEADER_REFERER,
  constants.HTTP2_HEADER_RETRY_AFTER,
  constants.HTTP2_HEADER_TK,
  constants.HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS,
  constants.HTTP2_HEADER_USER_AGENT,
  constants.HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS,
]);

type NativeHttp2HeaderValue = {
  name: string;
  value: string;
  neverIndex?: boolean;
};

type Settings = {
  headerTableSize: number;
  enablePush: number;
  maxConcurrentStreams: number;
  initialWindowSize: number;
  maxFrameSize: number;
  maxHeaderListSize: number;
};

class Http2Session extends EventEmitter {}

class ClientStream extends EventEmitter {}
class Http2Stream extends EventEmitter {}

function streamErrorFromCode(code: number) {
  const error = new Error(`Stream closed with error code ${code}`);
  error.code = "ERR_HTTP2_STREAM_ERROR";
  error.errno = code;
  return error;
}

function assertPseudoHeader(name: string) {
  if (ValidPseudoHeaders.has(name)) return;

  const error = new TypeError(`"${name}" is an invalid pseudoheader or is used incorrectly`);
  error.code = "ERR_HTTP2_INVALID_PSEUDOHEADER";
  throw error;
}

function assertSingleValueHeader(name: string) {
  if (!SingleValueHeaders.has(name)) return;

  const error = new TypeError(`Header field "${name}" must only have a single value`);
  error.code = "ERR_HTTP2_INVALID_SINGLE_VALUE_HEADER";
  throw error;
}

function reduceToCompatibleHeaders(obj: any, currentValue: any) {
  let { name, value } = currentValue;
  if (name === constants.HTTP2_HEADER_STATUS) {
    value = parseInt(value, 10);
  }
  const lastValue = obj[name];
  if (typeof lastValue === "string" || typeof lastValue === "number") {
    obj[name] = [obj[name], value];
  } else if (Array.isArray(lastValue)) {
    obj[name].push(value);
  } else {
    obj[name] = value;
  }
  return obj;
}

class ClientHttp2Stream extends Duplex {
  #id: number;
  #session: ClientHttp2Session | null = null;
  #endStream: boolean = false;
  [bunHTTP2Closed]: boolean = false;
  rstCode: number | undefined = undefined;
  [bunHTTP2StreamReadQueue]: Array<Buffer> = $createFIFO();
  [bunHTTP2StreamResponded]: boolean = false;
  #headers: any;
  #sentTrailers: any;
  constructor(streamId, session, headers) {
    super();
    this.#id = streamId;
    this.#session = session;
    this.#headers = headers;
  }

  get id() {
    return this.#id;
  }

  get pending() {
    return !this.#id;
  }

  get bufferSize() {
    // we have no buffer
    // we write into TLSSocket/Socket directly and let it buffer for us
    return 0;
  }

  get sentHeaders() {
    return this.#headers;
  }

  get sentInfoHeaders() {
    // TODO CONTINUE frames here
    return [];
  }

  get sentTrailers() {
    return this.#sentTrailers;
  }

  sendTrailers(headers) {
    if (this.#sentTrailers) return;
    const session = this.#session;
    if (session) {
      session[bunHTTP2Native]?.sendTrailers(this.#id, headers);
      this.#sentTrailers = headers;
      return true;
    }
    return false;
  }

  setTimeout(timeout, callback) {
    // per stream timeout not implemented yet
    const session = this.#session;
    if (session) {
      return session.setTimeout(timeout, callback);
    }
    if (typeof callback == "function") {
      callback();
    }
  }

  get state() {
    const session = this.#session;
    if (session) {
      return session[bunHTTP2Native]?.getStreamState(this.#id);
    }
  }

  priority(options) {
    if (!options) return false;
    if (options.silent) return false;
    const session = this.#session;
    if (session) {
      session[bunHTTP2Native]?.setStreamPriority(this.#id, options);
      return true;
    }
    return false;
  }

  set endAfterHeaders(value: boolean) {
    const session = this.#session;
    if (session) {
      session[bunHTTP2Native]?.setEndAfterHeaders(this.#id, value);
    }
  }

  get endAfterHeaders() {
    const session = this.#session;
    if (session) {
      return session[bunHTTP2Native]?.getEndAfterHeaders(this.#id) || false;
    }
    return false;
  }

  get aborted() {
    const session = this.#session;
    if (session) {
      return session[bunHTTP2Native]?.isStreamAborted(this.#id) || false;
    }
    return false;
  }

  get session() {
    return this.#session;
  }

  get pushAllowed() {
    // not implemented yet aka server side
    return false;
  }

  pushStream() {
    // not implemented yet aka server side
  }
  respondWithFile() {
    // not implemented yet aka server side
  }
  respondWithFd() {
    // not implemented yet aka server side
  }
  respond() {
    // not implemented yet aka server side
  }
  close(code, callback) {
    if (!this[bunHTTP2Closed]) {
      const session = this.#session;
      if (session) {
        if (code < 0 || code > 13) {
          throw new RangeError("Invalid error code");
        }
        this[bunHTTP2Closed] = true;
        session[bunHTTP2Native]?.rstStream(this.#id, code || 0);
        this.rstCode = code;
      }
    }
    if (typeof callback === "function") {
      this.once("close", callback);
    }
  }
  _destroy(err, callback) {
    if (!this[bunHTTP2Closed]) {
      const session = this.#session;
      if (session) {
        session[bunHTTP2Native]?.rstStream(this.#id, 0);
        this.rstCode = 0;
      }
    }
    callback(err);
  }

  _final(callback) {
    callback();
  }

  _read(size) {
    const queue = this[bunHTTP2StreamReadQueue];
    let chunk;
    while ((chunk = queue.peek())) {
      if (!this.push(chunk)) {
        queue.shift();
        return;
      }
      queue.shift();
    }
  }

  end(chunk, encoding, callback) {
    if (!chunk) {
      chunk = Buffer.alloc(0);
    }
    this.#endStream = true;
    return super.end(chunk, encoding, callback);
  }

  _write(chunk, encoding, callback) {
    if (typeof chunk == "string" && encoding !== "ascii") chunk = Buffer.from(chunk, encoding);
    const session = this.#session;
    if (session) {
      session[bunHTTP2Native]?.writeStream(this.#id, chunk, this.#endStream);
      if (typeof callback == "function") {
        callback();
      }
    }
  }
}

class ClientHttp2Session extends Http2Session {
  #closed: boolean = false;
  #queue: Array<Buffer> = [];
  #connecions: number = 0;
  [bunHTTP2Socket]: TLSSocket | Socket | null;
  #socket_proxy: Proxy<TLSSocket | Socket>;
  #parser: typeof H2FrameParser | null;
  #url: URL;
  #originSet = new Set<string>();
  #streams = new Map<number, any>();
  #isServer: boolean = false;
  #localSettings: Settings | null = {
    headerTableSize: 4096,
    enablePush: 1,
    maxConcurrentStreams: 100,
    initialWindowSize: 65535,
    maxFrameSize: 16384,
    maxHeaderListSize: 65535,
  };
  #pendingSettingsAck: boolean = true;
  #remoteSettings: Settings | null = null;

  static #Handlers = {
    binaryType: "buffer",
    streamStart(self: ClientHttp2Session, streamId: number) {
      self.#connecions++;
      var stream = self.#streams.get(streamId);
      if (stream) {
        stream.emit("session", stream);
      }
    },
    streamError(self: ClientHttp2Session, streamId: number, error: number) {
      var stream = self.#streams.get(streamId);
      const error_instance = streamErrorFromCode(error);
      if (stream) {
        if (!stream[bunHTTP2Closed]) {
          stream[bunHTTP2Closed] = true;
          stream.rstCode = error;
        }
        stream.emit("error", error_instance);
        self.emit("sessionError", error_instance);
      }
      self.emit("streamError", error_instance);
    },
    streamEnd(self: ClientHttp2Session, streamId: number) {
      self.#connecions--;
      var stream = self.#streams.get(streamId);
      if (stream) {
        stream.emit("end");
      }
      if (self.#connecions === 0 && self.#closed) {
        self[bunHTTP2Socket]?.end();
        self.#parser?.detach();
        self.#parser = null;
        self.emit("close");
      }
    },
    streamData(self: ClientHttp2Session, streamId: number, data: Buffer) {
      var stream = self.#streams.get(streamId);
      if (stream) {
        const queue = stream[bunHTTP2StreamReadQueue];

        if (queue.isEmpty()) {
          if (stream.push(data)) return;
        }
        queue.push(data);
      }
    },
    streamHeaders(self: ClientHttp2Session, streamId: number, headers: Array<NativeHttp2HeaderValue>, flags: number) {
      var stream = self.#streams.get(streamId);
      if (stream) {
        if (stream[bunHTTP2StreamResponded]) {
          stream.emit("trailers", headers.reduce(reduceToCompatibleHeaders), flags);
        } else {
          stream[bunHTTP2StreamResponded] = true;
          stream.emit("response", headers.reduce(reduceToCompatibleHeaders), flags);
        }
      }
    },
    localSettings(self: ClientHttp2Session, settings: Settings) {
      self.emit("localSettings", settings);
      self.#localSettings = settings;
      self.#pendingSettingsAck = false;
    },
    remoteSettings(self: ClientHttp2Session, settings: Settings) {
      self.emit("remoteSettings", settings);
      self.#remoteSettings = settings;
    },
    ping(self: ClientHttp2Session, ping: Buffer) {
      self.emit("ping", ping);
    },
    error(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      self.emit("error", new Error("ERROR_HTTP2"));
      self[bunHTTP2Socket]?.end();
      self.#parser?.detach();
      self.#parser = null;
    },
    aborted(self: ClientHttp2Session, streamId: number, error: any) {
      var stream = self.#streams.get(streamId);
      if (stream) {
        stream.emit("aborted", error);
      }
    },
    wantTrailer(self: ClientHttp2Session, streamId: number) {
      var stream = self.#streams.get(streamId);
      if (stream) {
        stream.emit("wantTrailers");
      }
    },
    goaway(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      self.emit("goaway", errorCode, lastStreamId, opaqueData);
      self[bunHTTP2Socket]?.end();
      self.#parser?.detach();
      self.#parser = null;
    },
    end(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      self[bunHTTP2Socket]?.end();
      self.#parser.detach();
      self.#parser = null;
    },
    write(self: ClientHttp2Session, buffer: Buffer) {
      const socket = self[bunHTTP2Socket];
      if (self.#closed) {
        //queue
        self.#queue.push(buffer);
      } else {
        // redirect writes to socket
        socket.write(buffer);
      }
    },
  };

  #onRead(data: Buffer) {
    this.#parser?.read(data);
  }
  get originSet() {
    if (this.encrypted) {
      return Array.from(this.#originSet);
    }
  }
  get alpnProtocol() {
    const socket = this[bunHTTP2Socket];
    if (!socket) return;
    return (socket as TLSSocket).alpnProtocol;
  }
  #onConnect() {
    this.#closed = false;
    const socket = this[bunHTTP2Socket] as TLSSocket;
    if (socket.alpnProtocol !== "h2") {
      socket.end();
      this.emit("error", new Error("h2 is not supported"));
    }
    this.#originSet.add(socket.remoteAddress as string);
    this.emit("origin", this.#originSet);
    // TODO: make a native bindings on data and write and fallback to non-native
    socket.on("data", this.#onRead.bind(this));
    // connected!
    this.emit("connect", this, socket);
    this.emit("connection", socket);

    // redirect the queued buffers
    const queue = this.#queue;
    while (queue.length) {
      socket.write(queue.shift());
    }
  }

  #onClose() {
    this.#parser?.detach();
    this.#parser = null;
    this.emit("close");
    this[bunHTTP2Socket] = null;
  }
  #onError(error: Error) {
    this.#parser?.detach();
    this.#parser = null;
    this.emit("error", error);
  }
  #onTimeout() {
    for (let [_, stream] of this.#streams) {
      stream.emit("timeout");
      stream.end();
    }
    this.#parser?.detach();
    this.#parser = null;
    this.emit("timeout");
  }

  get connected() {
    return this[bunHTTP2Socket]?.connecting === false;
  }
  get destroyed() {
    return this[bunHTTP2Socket] === null;
  }
  get encrypted() {
    const socket = this[bunHTTP2Socket];
    if (!socket) return;

    return socket instanceof TLSSocket;
  }
  get closed() {
    return this.#closed;
  }

  get remoteSettings() {
    return this.#remoteSettings;
  }

  get localSettings() {
    return this.#localSettings;
  }

  get pendingSettingsAck() {
    return this.#pendingSettingsAck;
  }

  get type() {
    if (this.#isServer) return 0;
    return 1;
  }
  unref() {
    return this[bunHTTP2Socket]?.unref();
  }
  ref() {
    return this[bunHTTP2Socket]?.ref();
  }
  setTimeout(msecs, callback) {
    return this[bunHTTP2Socket]?.setTimeout(msecs, callback);
  }
  ping(payload, callback) {
    if (typeof callback === "function") {
      this.once("ping", callback);
    }
    payload = payload || Buffer.alloc(8);
    if (payload.byteLength !== 8) {
      throw new Error("ERR_HTTP2_PING_PAYLOAD_SIZE");
    }
    this.#parser?.ping(payload);
    return this.#parser && this[bunHTTP2Socket] ? true : false;
  }
  goaway(errorCode, lastStreamId, opaqueData) {
    return this.#parser?.goaway(errorCode, lastStreamId, opaqueData);
  }

  setLocalWindowSize(windowSize) {
    return this.#parser?.setLocalWindowSize(windowSize);
  }
  get socket() {
    const socket = this[bunHTTP2Socket];
    if (!socket) return null;
    if (this.#socket_proxy) return this.#socket_proxy;
    this.#socket_proxy = new Proxy(socket, proxySocketHandler);
    return this.#socket_proxy;
  }
  get state() {
    return this.#parser?.getCurrentState();
  }

  settings(settings: Settings, callback) {
    this.#pendingSettingsAck = true;
    this.#parser?.settings(settings);
    if (callback) {
      const start = Date.now();
      this.once("localSettings", () => {
        callback(null, this.#localSettings, Date.now() - start);
      });
    }
  }

  constructor(url: string | URL, options?: Settings) {
    super();

    if (typeof url === "string") {
      url = new URL(url);
    }
    if (!(url instanceof URL)) {
      throw new Error("ERR_HTTP2: Invalid URL");
    }
    this.#isServer = true;
    this.#url = url;
    const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
    // TODO: h2c or HTTP2 Over Cleartext
    // h2c is not supported yet but should
    // need to implement upgrade from http1.1 to h2c
    // we can use picohttp to do that
    // browsers dont support h2c (and probably never will)

    // h2 with ALPNProtocols
    const socket = tls.connect(
      {
        host: url.hostname,
        port,
        ALPNProtocols: ["h2", "http/1.1"],
      },
      this.#onConnect.bind(this),
    );
    this[bunHTTP2Socket] = socket;
    this.#parser = new H2FrameParser({
      context: this,
      settings: options,
      handlers: ClientHttp2Session.#Handlers,
    });
    socket.on("close", this.#onClose.bind(this));
    socket.on("error", this.#onError.bind(this));
    socket.on("timeout", this.#onTimeout.bind(this));
  }

  // Gracefully closes the Http2Session, allowing any existing streams to complete on their own and preventing new Http2Stream instances from being created. Once closed, http2session.destroy() might be called if there are no open Http2Stream instances.
  // If specified, the callback function is registered as a handler for the 'close' event.
  close(callback: Function) {
    this.#closed = true;
    if (typeof callback === "function") {
      this.on("close", callback);
    }
  }

  destroy(error: Error, code: number) {
    const socket = this[bunHTTP2Socket];
    if (!socket) return;
    this.goaway(code || constants.NGHTTP2_INTERNAL_ERROR, 0, Buffer.alloc(0));
    this.#parser?.detach();
    socket.end();
    this.#parser = null;
    this[bunHTTP2Socket] = null;
    // this should not be needed since RST + GOAWAY should be sent
    for (let [_, stream] of this.#streams) {
      if (error) {
        stream.emit("error", error);
      }
      stream.emit("close");
      stream.end();
    }

    if (error) {
      this.emit("error", error);
    }

    this.emit("close");
  }

  request(headers: any, options?: any) {
    if (!(headers instanceof Object)) {
      throw new Error("ERROR_HTTP2: Invalid headers");
    }
    options = options || {};
    const flat_headers: Array<NativeHttp2HeaderValue> = [];
    let has_scheme = false;
    let authority: any = null;
    let method: string | null = null;
    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!Array.isArray(sensitives)) {
        const error = new TypeError("headers[http2.neverIndex]");
        error.code = "ERR_INVALID_ARG_VALUE";
        throw error;
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }

    Object.keys(headers).forEach(key => {
      //@ts-ignore
      if (key === sensitiveHeaders) {
        return;
      }
      if (key.startsWith(":")) {
        assertPseudoHeader(key);
      }
      switch (key) {
        case constants.HTTP2_HEADER_SCHEME:
          has_scheme = true;
          break;
        case constants.HTTP2_HEADER_AUTHORITY:
          authority = headers[key];
          break;
        case constants.HTTP2_HEADER_METHOD:
          method = headers[key]?.toString() || "GET";
          break;
      }

      const value = headers[key];
      if (Array.isArray(value)) {
        assertSingleValueHeader(key);
        for (let i = 0; i < value.length; i++) {
          flat_headers.push({ name: key, value: value[i]?.toString(), neverIndex: sensitiveNames[key] || false });
        }
      } else {
        flat_headers.push({ name: key, value: value?.toString() });
      }
    });

    const url = this.#url;
    if (!has_scheme) {
      let protocol: string = options?.protocol || "https";
      switch (url.protocol) {
        case "https:":
          protocol = "https";
          break;
        case "http:":
          protocol = "http";
          break;
      }

      flat_headers.push({ name: ":scheme", value: protocol });
    }
    if (!authority) {
      authority = { name: ":authority", value: url.hostname };
      flat_headers.push(authority);
    }

    if (!method) {
      method = "GET";
      flat_headers.push({ name: ":method", value: method });
    }

    if (NoPayloadMethods.has(method.toUpperCase())) {
      options.endStream = true;
    }

    let stream_id: number;
    if (typeof options === undefined) {
      stream_id = this.#parser.request(flat_headers);
    } else {
      stream_id = this.#parser.request(flat_headers, options);
    }
    const req = new ClientHttp2Stream(stream_id, this, headers);
    req.authority = authority;
    this.#streams.set(stream_id, req);
    req.emit("ready");
    return req;
  }
  static connect(url: string | URL, options?: Settings) {
    if (options) {
      return new ClientHttp2Session(url, options);
    }
    return new ClientHttp2Session(url);
  }

  get [bunHTTP2Native]() {
    return this.#parser;
  }
}

function connect(url: string | URL, options?: Settings) {
  if (options) {
    return ClientHttp2Session.connect(url, options);
  }
  return ClientHttp2Session.connect(url);
}

function createServer() {
  throwNotImplemented("node:http2 createServer", 887);
}
function createSecureServer() {
  throwNotImplemented("node:http2 createSecureServer", 887);
}
function getDefaultSettings() {
  return {
    headerTableSize: 4096,
    enablePush: true,
    initialWindowSize: 65535,
    maxFrameSize: 16384,
    maxConcurrentStreams: 4294967295,
    maxHeaderSize: 65535,
    maxHeaderListSize: 65535,
    enableConnectProtocol: false,
  };
}
function getPackedSettings() {
  return Buffer.alloc(0);
}
function getUnpackedSettings() {
  return Buffer.alloc(0);
}
function Http2ServerRequest() {
  throwNotImplemented("node:http2 Http2ServerRequest", 887);
}
Http2ServerRequest.prototype = {};
function Http2ServerResponse() {
  throwNotImplemented("node:http2 Http2ServerResponse", 887);
}
Http2ServerResponse.prototype = {};

export default {
  constants,
  createServer,
  createSecureServer,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
  Http2ServerRequest,
  Http2ServerResponse,
  connect,
  ClientHttp2Session,
};

hideFromStack([
  Http2ServerRequest,
  Http2ServerResponse,
  connect,
  createServer,
  createSecureServer,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  ClientHttp2Session,
  ClientHttp2Stream,
]);
