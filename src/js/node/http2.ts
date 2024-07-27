// Hardcoded module "node:http2"

const { isTypedArray } = require("node:util/types");

// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");

const tls = require("node:tls");
const net = require("node:net");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
type Http2ConnectOptions = { settings?: Settings; protocol?: "https:" | "http:"; createConnection?: Function };
const TLSSocket = tls.TLSSocket;
const EventEmitter = require("node:events");
const { Duplex } = require("node:stream");
const primordials = require("internal/primordials");

const [H2FrameParser, getPackedSettings, getUnpackedSettings] = $zig("h2_frame_parser.zig", "createNodeHttp2Binding");

const sensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");
const bunHTTP2Native = Symbol.for("::bunhttp2native::");
const bunHTTP2StreamResponded = Symbol.for("::bunhttp2hasResponded::");
const bunHTTP2StreamReadQueue = Symbol.for("::bunhttp2ReadQueue::");
const bunHTTP2Closed = Symbol.for("::bunhttp2closed::");
const bunHTTP2Socket = Symbol.for("::bunhttp2socket::");
const bunHTTP2WantTrailers = Symbol.for("::bunhttp2WantTrailers::");
const bunHTTP2Session = Symbol.for("::bunhttp2session::");

const ReflectGetPrototypeOf = Reflect.getPrototypeOf;
const FunctionPrototypeBind = primordials.FunctionPrototypeBind;
const StringPrototypeSlice = String.prototype.slice;

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

type Settings = {
  headerTableSize: number;
  enablePush: boolean;
  maxConcurrentStreams: number;
  initialWindowSize: number;
  maxFrameSize: number;
  maxHeaderListSize: number;
  maxHeaderSize: number;
};

class Http2Session extends EventEmitter {}

function streamErrorFromCode(code: number) {
  const error = new Error(`Stream closed with error code ${code}`);
  error.code = "ERR_HTTP2_STREAM_ERROR";
  error.errno = code;
  return error;
}
function sessionErrorFromCode(code: number) {
  const error = new Error(`Session closed with error code ${code}`);
  error.code = "ERR_HTTP2_SESSION_ERROR";
  error.errno = code;
  return error;
}
function assertSession(session) {
  if (!session) {
    const error = new Error(`ERR_HTTP2_INVALID_SESSION: The session has been destroyed`);
    error.code = "ERR_HTTP2_INVALID_SESSION";
    throw error;
  }
}

class ClientHttp2Stream extends Duplex {
  #id: number;
  [bunHTTP2Session]: ClientHttp2Session | null = null;
  #endStream: boolean = false;
  [bunHTTP2WantTrailers]: boolean = false;
  [bunHTTP2Closed]: boolean = false;
  rstCode: number | undefined = undefined;
  [bunHTTP2StreamReadQueue]: Array<Buffer> = $createFIFO();
  [bunHTTP2StreamResponded]: boolean = false;
  #headers: any;
  #sentTrailers: any;
  constructor(streamId, session, headers) {
    super();
    this.#id = streamId;
    this[bunHTTP2Session] = session;
    this.#headers = headers;
  }

  get scheme() {
    return this.#headers[":scheme"] || "https";
  }

  get id() {
    return this.#id;
  }

  get pending() {
    return !this.#id;
  }

  get bufferSize() {
    const session = this[bunHTTP2Session];
    if (!session) return 0;
    return session[bunHTTP2Socket]?.bufferSize || 0;
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
    const session = this[bunHTTP2Session];
    assertSession(session);

    if (this.destroyed || this.closed) {
      const error = new Error(`ERR_HTTP2_INVALID_STREAM: The stream has been destroyed`);
      error.code = "ERR_HTTP2_INVALID_STREAM";
      throw error;
    }

    if (this.#sentTrailers) {
      const error = new Error(`ERR_HTTP2_TRAILERS_ALREADY_SENT: Trailing headers have already been sent`);
      error.code = "ERR_HTTP2_TRAILERS_ALREADY_SENT";
      throw error;
    }

    if (!this[bunHTTP2WantTrailers]) {
      const error = new Error(
        `ERR_HTTP2_TRAILERS_NOT_READY: Trailing headers cannot be sent until after the wantTrailers event is emitted`,
      );
      error.code = "ERR_HTTP2_TRAILERS_NOT_READY";
      throw error;
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isJSArray(sensitives)) {
        const error = new TypeError("ERR_INVALID_ARG_VALUE: The argument headers[http2.neverIndex] is invalid");
        error.code = "ERR_INVALID_ARG_VALUE";
        throw error;
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }

    session[bunHTTP2Native]?.sendTrailers(this.#id, headers, sensitiveNames);
    this.#sentTrailers = headers;
  }

  setTimeout(timeout, callback) {
    // per stream timeout not implemented yet
    const session = this[bunHTTP2Session];
    assertSession(session);
    session.setTimeout(timeout, callback);
  }

  get closed() {
    return this[bunHTTP2Closed];
  }

  get destroyed() {
    return this[bunHTTP2Session] === null;
  }

  get state() {
    const session = this[bunHTTP2Session];
    if (session) {
      return session[bunHTTP2Native]?.getStreamState(this.#id);
    }
    return constants.NGHTTP2_STREAM_STATE_CLOSED;
  }

  priority(options) {
    if (!options) return false;
    if (options.silent) return false;
    const session = this[bunHTTP2Session];
    assertSession(session);

    session[bunHTTP2Native]?.setStreamPriority(this.#id, options);
  }

  set endAfterHeaders(value: boolean) {
    const session = this[bunHTTP2Session];
    assertSession(session);
    session[bunHTTP2Native]?.setEndAfterHeaders(this.#id, value);
  }

  get endAfterHeaders() {
    const session = this[bunHTTP2Session];
    if (session) {
      return session[bunHTTP2Native]?.getEndAfterHeaders(this.#id) || false;
    }
    return false;
  }

  get aborted() {
    const session = this[bunHTTP2Session];
    if (session) {
      return session[bunHTTP2Native]?.isStreamAborted(this.#id) || false;
    }
    return false;
  }

  get session() {
    return this[bunHTTP2Session];
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
      const session = this[bunHTTP2Session];
      assertSession(session);

      if (code < 0 || code > 13) {
        throw new RangeError("Invalid error code");
      }
      this[bunHTTP2Closed] = true;
      session[bunHTTP2Native]?.rstStream(this.#id, code || 0);
      this.rstCode = code;
    }
    if (typeof callback === "function") {
      this.once("close", callback);
    }
  }
  _destroy(err, callback) {
    if (!this[bunHTTP2Closed]) {
      this[bunHTTP2Closed] = true;

      const session = this[bunHTTP2Session];
      assertSession(session);

      session[bunHTTP2Native]?.rstStream(this.#id, 0);
      this.rstCode = 0;
      this[bunHTTP2Session] = null;
    }

    callback(err);
  }

  _final(callback) {
    this[bunHTTP2Closed] = true;
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
    const session = this[bunHTTP2Session];
    if (session) {
      session[bunHTTP2Native]?.writeStream(this.#id, chunk, this.#endStream);
      if (typeof callback == "function") {
        callback();
      }
    }
  }
}

function connectWithProtocol(protocol: string, options: Http2ConnectOptions | string | URL, listener?: Function) {
  if (protocol === "http:") {
    return net.connect(options, listener);
  }
  return tls.connect(options, listener);
}

function emitWantTrailersNT(streams, streamId) {
  const stream = streams.get(streamId);
  if (stream) {
    stream[bunHTTP2WantTrailers] = true;
    stream.emit("wantTrailers");
  }
}

function emitConnectNT(self, socket) {
  self.emit("connect", self, socket);
}

function emitStreamNT(self, streams, streamId) {
  const stream = streams.get(streamId);
  if (stream) {
    self.emit("stream", stream);
  }
}

function emitStreamErrorNT(self, streams, streamId, error, destroy) {
  const stream = streams.get(streamId);

  if (stream) {
    if (!stream[bunHTTP2Closed]) {
      stream[bunHTTP2Closed] = true;
    }
    stream.rstCode = error;

    const error_instance = streamErrorFromCode(error);
    stream.emit("error", error_instance);
    if (destroy) stream.destroy(error_instance, error);
  }
}

function emitAbortedNT(self, streams, streamId, error) {
  const stream = streams.get(streamId);
  if (stream) {
    if (!stream[bunHTTP2Closed]) {
      stream[bunHTTP2Closed] = true;
    }

    stream.rstCode = constants.NGHTTP2_CANCEL;
    stream.emit("aborted");
  }
}
class ClientHttp2Session extends Http2Session {
  /// close indicates that we called closed
  #closed: boolean = false;
  /// connected indicates that the connection/socket is connected
  #connected: boolean = false;
  #queue: Array<Buffer> = [];
  #connections: number = 0;
  [bunHTTP2Socket]: TLSSocket | Socket | null;
  #socket_proxy: Proxy<TLSSocket | Socket>;
  #parser: typeof H2FrameParser | null;
  #url: URL;
  #originSet = new Set<string>();
  #streams = new Map<number, any>();
  #isServer: boolean = false;
  #alpnProtocol: string | undefined = undefined;
  #localSettings: Settings | null = {
    headerTableSize: 4096,
    enablePush: true,
    maxConcurrentStreams: 100,
    initialWindowSize: 65535,
    maxFrameSize: 16384,
    maxHeaderListSize: 65535,
    maxHeaderSize: 65535,
  };
  #encrypted: boolean = false;
  #pendingSettingsAck: boolean = true;
  #remoteSettings: Settings | null = null;
  #pingCallbacks: Array<[Function, number]> | null = null;

  static #Handlers = {
    binaryType: "buffer",
    streamStart(self: ClientHttp2Session, streamId: number) {
      if (!self) return;
      self.#connections++;
      process.nextTick(emitStreamNT, self, self.#streams, streamId);
    },
    streamError(self: ClientHttp2Session, streamId: number, error: number) {
      if (!self) return;
      var stream = self.#streams.get(streamId);
      if (stream) {
        const error_instance = streamErrorFromCode(error);
        if (!stream[bunHTTP2Closed]) {
          stream[bunHTTP2Closed] = true;
        }
        stream.rstCode = error;

        stream.emit("error", error_instance);
      } else {
        process.nextTick(emitStreamErrorNT, self, self.#streams, streamId, error);
      }
    },
    streamEnd(self: ClientHttp2Session, streamId: number) {
      if (!self) return;
      var stream = self.#streams.get(streamId);
      if (stream) {
        self.#connections--;
        self.#streams.delete(streamId);
        stream[bunHTTP2Closed] = true;
        stream[bunHTTP2Session] = null;
        stream.rstCode = 0;
        stream.emit("end");
        stream.emit("close");
        stream.destroy();
      }
      if (self.#connections === 0 && self.#closed) {
        self.destroy();
      }
    },
    streamData(self: ClientHttp2Session, streamId: number, data: Buffer) {
      if (!self) return;
      var stream = self.#streams.get(streamId);
      if (stream) {
        const queue = stream[bunHTTP2StreamReadQueue];

        if (queue.isEmpty()) {
          if (stream.push(data)) return;
        }
        queue.push(data);
      }
    },
    streamHeaders(
      self: ClientHttp2Session,
      streamId: number,
      headers: Record<string, string | string[]>,
      flags: number,
    ) {
      if (!self) return;
      var stream = self.#streams.get(streamId);
      if (!stream) return;

      let status: string | number = headers[":status"] as string;
      if (status) {
        // client status is always number
        status = parseInt(status as string, 10);
        (headers as Record<string, string | number>)[":status"] = status;
      }

      let set_cookies = headers["set-cookie"];
      if (typeof set_cookies === "string") {
        (headers as Record<string, string | string[]>)["set-cookie"] = [set_cookies];
      }

      let cookie = headers["cookie"];
      if ($isArray(cookie)) {
        headers["cookie"] = (headers["cookie"] as string[]).join(";");
      }
      if (stream[bunHTTP2StreamResponded]) {
        try {
          stream.emit("trailers", headers, flags);
        } catch {
          process.nextTick(emitStreamErrorNT, self, self.#streams, streamId, constants.NGHTTP2_PROTOCOL_ERROR, true);
        }
      } else {
        stream[bunHTTP2StreamResponded] = true;
        stream.emit("response", headers, flags);
      }
    },
    localSettings(self: ClientHttp2Session, settings: Settings) {
      if (!self) return;
      self.emit("localSettings", settings);
      self.#localSettings = settings;
      self.#pendingSettingsAck = false;
    },
    remoteSettings(self: ClientHttp2Session, settings: Settings) {
      if (!self) return;
      self.emit("remoteSettings", settings);
      self.#remoteSettings = settings;
    },
    ping(self: ClientHttp2Session, payload: Buffer, isACK: boolean) {
      if (!self) return;
      self.emit("ping", payload);
      if (isACK) {
        const callbacks = self.#pingCallbacks;
        if (callbacks) {
          const callbackInfo = callbacks.shift();
          if (callbackInfo) {
            const [callback, start] = callbackInfo;
            callback(null, Date.now() - start, payload);
          }
        }
      }
    },
    error(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.emit("error", sessionErrorFromCode(errorCode));

      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    aborted(self: ClientHttp2Session, streamId: number, error: any) {
      if (!self) return;
      var stream = self.#streams.get(streamId);
      if (stream) {
        if (!stream[bunHTTP2Closed]) {
          stream[bunHTTP2Closed] = true;
        }

        stream.rstCode = constants.NGHTTP2_CANCEL;
        stream.emit("aborted");
      } else {
        process.nextTick(emitAbortedNT, self, self.#streams, streamId, error);
      }
    },
    wantTrailers(self: ClientHttp2Session, streamId: number) {
      if (!self) return;
      var stream = self.#streams.get(streamId);
      if (stream) {
        stream[bunHTTP2WantTrailers] = true;
        stream.emit("wantTrailers");
      } else {
        process.nextTick(emitWantTrailersNT, self.#streams, streamId);
      }
    },
    goaway(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.emit("goaway", errorCode, lastStreamId, opaqueData);
      if (errorCode !== 0) {
        for (let [_, stream] of self.#streams) {
          stream.rstCode = errorCode;
          stream.destroy(sessionErrorFromCode(errorCode), errorCode);
        }
      }
      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    end(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    write(self: ClientHttp2Session, buffer: Buffer) {
      if (!self) return;
      const socket = self[bunHTTP2Socket];
      if (!socket) return;
      if (self.#connected) {
        // redirect writes to socket
        socket.write(buffer);
      } else {
        //queue
        self.#queue.push(buffer);
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
    return this.#alpnProtocol;
  }
  #onConnect() {
    const socket = this[bunHTTP2Socket];
    if (!socket) return;
    this.#connected = true;
    // check if h2 is supported only for TLSSocket
    if (socket instanceof TLSSocket) {
      if (socket.alpnProtocol !== "h2") {
        socket.end();
        const error = new Error("ERR_HTTP2_ERROR: h2 is not supported");
        error.code = "ERR_HTTP2_ERROR";
        this.emit("error", error);
      }
      this.#alpnProtocol = "h2";

      const origin = socket[bunTLSConnectOptions]?.serverName || socket.remoteAddress;
      this.#originSet.add(origin);
      this.emit("origin", this.originSet);
    } else {
      this.#alpnProtocol = "h2c";
    }

    // TODO: make a native bindings on data and write and fallback to non-native
    socket.on("data", this.#onRead.bind(this));

    // redirect the queued buffers
    const queue = this.#queue;
    while (queue.length) {
      socket.write(queue.shift());
    }
    process.nextTick(emitConnectNT, this, socket);
  }

  #onClose() {
    this.#parser = null;
    this[bunHTTP2Socket] = null;
    this.emit("close");
  }
  #onError(error: Error) {
    this.#parser = null;
    this[bunHTTP2Socket] = null;
    this.emit("error", error);
  }
  #onTimeout() {
    for (let [_, stream] of this.#streams) {
      stream.emit("timeout");
    }
    this.emit("timeout");
    this.destroy();
  }
  get connecting() {
    const socket = this[bunHTTP2Socket];
    if (!socket) {
      return false;
    }
    return socket.connecting || false;
  }
  get connected() {
    return this[bunHTTP2Socket]?.connecting === false;
  }
  get destroyed() {
    return this[bunHTTP2Socket] === null;
  }
  get encrypted() {
    return this.#encrypted;
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
    if (typeof payload === "function") {
      callback = payload;
      payload = Buffer.alloc(8);
    } else {
      payload = payload || Buffer.alloc(8);
    }
    if (!(payload instanceof Buffer) && !isTypedArray(payload)) {
      const error = new TypeError("ERR_INVALID_ARG_TYPE: payload must be a Buffer or TypedArray");
      error.code = "ERR_INVALID_ARG_TYPE";
      throw error;
    }
    const parser = this.#parser;
    if (!parser) return false;
    if (!this[bunHTTP2Socket]) return false;

    if (typeof callback === "function") {
      if (payload.byteLength !== 8) {
        const error = new RangeError("ERR_HTTP2_PING_LENGTH: HTTP2 ping payload must be 8 bytes");
        error.code = "ERR_HTTP2_PING_LENGTH";
        callback(error, 0, payload);
        return;
      }
      if (this.#pingCallbacks) {
        this.#pingCallbacks.push([callback, Date.now()]);
      } else {
        this.#pingCallbacks = [[callback, Date.now()]];
      }
    } else if (payload.byteLength !== 8) {
      const error = new RangeError("ERR_HTTP2_PING_LENGTH: HTTP2 ping payload must be 8 bytes");
      error.code = "ERR_HTTP2_PING_LENGTH";
      throw error;
    }

    parser.ping(payload);
    return true;
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
    this.#socket_proxy = new Proxy(this, proxySocketHandler);
    return this.#socket_proxy;
  }
  get state() {
    return this.#parser?.getCurrentState();
  }

  settings(settings: Settings, callback) {
    this.#pendingSettingsAck = true;
    this.#parser?.settings(settings);
    if (typeof callback === "function") {
      const start = Date.now();
      this.once("localSettings", () => {
        callback(null, this.#localSettings, Date.now() - start);
      });
    }
  }

  constructor(url: string | URL, options?: Http2ConnectOptions, listener?: Function) {
    super();

    if (typeof url === "string") {
      url = new URL(url);
    }
    if (!(url instanceof URL)) {
      throw new Error("ERR_HTTP2: Invalid URL");
    }
    if (typeof options === "function") {
      listener = options;
      options = undefined;
    }
    this.#isServer = true;
    this.#url = url;

    const protocol = url.protocol || options?.protocol || "https:";
    const port = url.port ? parseInt(url.port, 10) : protocol === "http:" ? 80 : 443;

    function onConnect() {
      this.#onConnect(arguments);
      listener?.$apply(this, arguments);
    }

    // h2 with ALPNProtocols
    let socket;
    if (typeof options?.createConnection === "function") {
      socket = options.createConnection(url, options);
      this[bunHTTP2Socket] = socket;
      if (socket.secureConnecting === true) {
        socket.on("secureConnect", onConnect.bind(this));
      } else if (socket.connecting === true) {
        socket.on("connect", onConnect.bind(this));
      } else {
        process.nextTick(onConnect.bind(this));
      }
    } else {
      socket = connectWithProtocol(
        protocol,
        options
          ? {
              host: url.hostname,
              port,
              ALPNProtocols: ["h2", "http/1.1"],
              ...options,
            }
          : {
              host: url.hostname,
              port,
              ALPNProtocols: ["h2", "http/1.1"],
            },
        onConnect.bind(this),
      );
      this[bunHTTP2Socket] = socket;
    }
    this.#encrypted = socket instanceof TLSSocket;

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
      this.once("close", callback);
    }
    if (this.#connections === 0) {
      this.destroy();
    }
  }

  destroy(error?: Error, code?: number) {
    const socket = this[bunHTTP2Socket];
    this.#closed = true;
    this.#connected = false;
    code = code || constants.NGHTTP2_NO_ERROR;
    if (socket) {
      this.goaway(code, 0, Buffer.alloc(0));
      socket.end();
    }
    this[bunHTTP2Socket] = null;
    // this should not be needed since RST + GOAWAY should be sent
    for (let [_, stream] of this.#streams) {
      if (error) {
        stream.emit("error", error);
      }
      stream.destroy();
      stream.rstCode = code;
      stream.emit("close");
    }

    if (error) {
      this.emit("error", error);
    }

    this.emit("close");
  }

  request(headers: any, options?: any) {
    if (this.destroyed || this.closed) {
      const error = new Error(`ERR_HTTP2_INVALID_STREAM: The stream has been destroyed`);
      error.code = "ERR_HTTP2_INVALID_STREAM";
      throw error;
    }

    if (this.sentTrailers) {
      const error = new Error(`ERR_HTTP2_TRAILERS_ALREADY_SENT: Trailing headers have already been sent`);
      error.code = "ERR_HTTP2_TRAILERS_ALREADY_SENT";
      throw error;
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isArray(sensitives)) {
        const error = new TypeError("ERR_INVALID_ARG_VALUE: The arguments headers[http2.neverIndex] is invalid");
        error.code = "ERR_INVALID_ARG_VALUE";
        throw error;
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }
    const url = this.#url;

    let authority = headers[":authority"];
    if (!authority) {
      authority = url.host;
      headers[":authority"] = authority;
    }
    let method = headers[":method"];
    if (!method) {
      method = "GET";
      headers[":method"] = method;
    }

    let scheme = headers[":scheme"];
    if (!scheme) {
      let protocol: string = url.protocol || options?.protocol || "https:";
      switch (protocol) {
        case "https:":
          scheme = "https";
          break;
        case "http:":
          scheme = "http";
          break;
        default:
          scheme = protocol;
      }
      headers[":scheme"] = scheme;
    }

    if (NoPayloadMethods.has(method.toUpperCase())) {
      options = options || {};
      options.endStream = true;
    }
    let stream_id: number;
    if (typeof options === "undefined") {
      stream_id = this.#parser.request(headers, sensitiveNames);
    } else {
      stream_id = this.#parser.request(headers, sensitiveNames, options);
    }

    if (stream_id < 0) {
      const error = new Error(
        "ERR_HTTP2_OUT_OF_STREAMS: No stream ID is available because maximum stream ID has been reached",
      );
      error.code = "ERR_HTTP2_OUT_OF_STREAMS";
      this.emit("error", error);
      return null;
    }
    const req = new ClientHttp2Stream(stream_id, this, headers);
    req.authority = authority;
    this.#streams.set(stream_id, req);
    req.emit("ready");
    return req;
  }
  static connect(url: string | URL, options?: Http2ConnectOptions, listener?: Function) {
    return new ClientHttp2Session(url, options, listener);
  }

  get [bunHTTP2Native]() {
    return this.#parser;
  }
}

function connect(url: string | URL, options?: Http2ConnectOptions, listener?: Function) {
  return ClientHttp2Session.connect(url, options, listener);
}

function createServer() {
  throwNotImplemented("node:http2 createServer", 8823);
}
function createSecureServer() {
  throwNotImplemented("node:http2 createSecureServer", 8823);
}
function getDefaultSettings() {
  // return default settings
  return getUnpackedSettings();
}
function Http2ServerRequest() {
  throwNotImplemented("node:http2 Http2ServerRequest", 8823);
}
Http2ServerRequest.prototype = {};
function Http2ServerResponse() {
  throwNotImplemented("node:http2 Http2ServerResponse", 8823);
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
