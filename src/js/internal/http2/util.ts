// Internal module for http2 utilities shared between node:http2 and
// Node.js-compat tests that require('internal/http2/util').
//
// Portions of this code are derived from the Node.js project.
// Copyright Node.js contributors. All rights reserved.
// Copyright Joyent, Inc. and other Node contributors. All rights reserved.
// Licensed under the MIT License.

const { hideFromStack } = require("internal/shared");
const { checkIsHttpToken } = require("internal/validators");
const { SafeSet } = require("internal/primordials");

const ArrayIsArray = Array.isArray;
const MathMax = Math.max;
const ObjectKeys = Object.keys;
const StringFromCharCode = String.fromCharCode;
const ArrayPrototypePush = Array.prototype.push;

// This must match `bunHTTP2Socket` in node/http2.ts so that session[kSocket]
// returns the underlying net/tls socket.
const kSocket = Symbol.for("::bunhttp2socket::");
// Must match the public `http2.sensitiveHeaders` symbol.
const kSensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");

const kAuthority = Symbol("authority");
const kProtocol = Symbol("protocol");
const kProxySocket = Symbol("proxySocket");
const kRequest = Symbol("request");

const MAX_ADDITIONAL_SETTINGS = 10;

const NGHTTP2_NV_FLAG_NONE = 0;
const NGHTTP2_NV_FLAG_NO_INDEX = 1;

const constants = {
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522,
  NGHTTP2_NV_FLAG_NONE,
  NGHTTP2_NV_FLAG_NO_INDEX,
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

const {
  NGHTTP2_SESSION_CLIENT,
  NGHTTP2_SESSION_SERVER,

  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_AUTHORITY,
  HTTP2_HEADER_SCHEME,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_PROTOCOL,
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS,
  HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE,
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD,
  HTTP2_HEADER_AGE,
  HTTP2_HEADER_AUTHORIZATION,
  HTTP2_HEADER_CONTENT_ENCODING,
  HTTP2_HEADER_CONTENT_LANGUAGE,
  HTTP2_HEADER_CONTENT_LENGTH,
  HTTP2_HEADER_CONTENT_LOCATION,
  HTTP2_HEADER_CONTENT_MD5,
  HTTP2_HEADER_CONTENT_RANGE,
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_COOKIE,
  HTTP2_HEADER_DATE,
  HTTP2_HEADER_DNT,
  HTTP2_HEADER_ETAG,
  HTTP2_HEADER_EXPIRES,
  HTTP2_HEADER_FROM,
  HTTP2_HEADER_HOST,
  HTTP2_HEADER_IF_MATCH,
  HTTP2_HEADER_IF_NONE_MATCH,
  HTTP2_HEADER_IF_MODIFIED_SINCE,
  HTTP2_HEADER_IF_RANGE,
  HTTP2_HEADER_IF_UNMODIFIED_SINCE,
  HTTP2_HEADER_LAST_MODIFIED,
  HTTP2_HEADER_LOCATION,
  HTTP2_HEADER_MAX_FORWARDS,
  HTTP2_HEADER_PROXY_AUTHORIZATION,
  HTTP2_HEADER_RANGE,
  HTTP2_HEADER_REFERER,
  HTTP2_HEADER_RETRY_AFTER,
  HTTP2_HEADER_SET_COOKIE,
  HTTP2_HEADER_TK,
  HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS,
  HTTP2_HEADER_USER_AGENT,
  HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS,

  HTTP2_HEADER_CONNECTION,
  HTTP2_HEADER_UPGRADE,
  HTTP2_HEADER_HTTP2_SETTINGS,
  HTTP2_HEADER_TE,
  HTTP2_HEADER_TRANSFER_ENCODING,
  HTTP2_HEADER_KEEP_ALIVE,
  HTTP2_HEADER_PROXY_CONNECTION,

  HTTP2_METHOD_DELETE,
  HTTP2_METHOD_GET,
  HTTP2_METHOD_HEAD,
} = constants;

// This set is defined strictly by the HTTP/2 specification. Only
// :-prefixed headers defined by that specification may be added to
// this set.
const kValidPseudoHeaders = new SafeSet([
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_AUTHORITY,
  HTTP2_HEADER_SCHEME,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_PROTOCOL,
]);

// This set contains headers that are permitted to have only a single
// value. Multiple instances must not be specified.
const kSingleValueHeaders = new SafeSet([
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_AUTHORITY,
  HTTP2_HEADER_SCHEME,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_PROTOCOL,
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS,
  HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE,
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD,
  HTTP2_HEADER_AGE,
  HTTP2_HEADER_AUTHORIZATION,
  HTTP2_HEADER_CONTENT_ENCODING,
  HTTP2_HEADER_CONTENT_LANGUAGE,
  HTTP2_HEADER_CONTENT_LENGTH,
  HTTP2_HEADER_CONTENT_LOCATION,
  HTTP2_HEADER_CONTENT_MD5,
  HTTP2_HEADER_CONTENT_RANGE,
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_DATE,
  HTTP2_HEADER_DNT,
  HTTP2_HEADER_ETAG,
  HTTP2_HEADER_EXPIRES,
  HTTP2_HEADER_FROM,
  HTTP2_HEADER_HOST,
  HTTP2_HEADER_IF_MATCH,
  HTTP2_HEADER_IF_MODIFIED_SINCE,
  HTTP2_HEADER_IF_NONE_MATCH,
  HTTP2_HEADER_IF_RANGE,
  HTTP2_HEADER_IF_UNMODIFIED_SINCE,
  HTTP2_HEADER_LAST_MODIFIED,
  HTTP2_HEADER_LOCATION,
  HTTP2_HEADER_MAX_FORWARDS,
  HTTP2_HEADER_PROXY_AUTHORIZATION,
  HTTP2_HEADER_RANGE,
  HTTP2_HEADER_REFERER,
  HTTP2_HEADER_RETRY_AFTER,
  HTTP2_HEADER_TK,
  HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS,
  HTTP2_HEADER_USER_AGENT,
  HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS,
]);

// The HTTP methods in this set are specifically defined as assigning no
// meaning to the request payload.
const kNoPayloadMethods = new SafeSet([HTTP2_METHOD_DELETE, HTTP2_METHOD_GET, HTTP2_METHOD_HEAD]);

// Bun does not use a native options buffer; this array mirrors the layout
// Node.js uses in `internalBinding('http2').optionsBuffer` so that
// `updateOptionsBuffer` and tests exercising it behave identically.
const IDX_OPTIONS_MAX_DEFLATE_DYNAMIC_TABLE_SIZE = 0;
const IDX_OPTIONS_MAX_RESERVED_REMOTE_STREAMS = 1;
const IDX_OPTIONS_MAX_SEND_HEADER_BLOCK_LENGTH = 2;
const IDX_OPTIONS_PEER_MAX_CONCURRENT_STREAMS = 3;
const IDX_OPTIONS_PADDING_STRATEGY = 4;
const IDX_OPTIONS_MAX_HEADER_LIST_PAIRS = 5;
const IDX_OPTIONS_MAX_OUTSTANDING_PINGS = 6;
const IDX_OPTIONS_MAX_OUTSTANDING_SETTINGS = 7;
const IDX_OPTIONS_MAX_SESSION_MEMORY = 8;
const IDX_OPTIONS_MAX_SETTINGS = 9;
const IDX_OPTIONS_STREAM_RESET_RATE = 10;
const IDX_OPTIONS_STREAM_RESET_BURST = 11;
const IDX_OPTIONS_STRICT_HTTP_FIELD_WHITESPACE_VALIDATION = 12;
const IDX_OPTIONS_FLAGS = 13;
const optionsBuffer = new Uint32Array(IDX_OPTIONS_FLAGS + 1);

function updateOptionsBuffer(options) {
  let flags = 0;
  if (typeof options.maxDeflateDynamicTableSize === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_DEFLATE_DYNAMIC_TABLE_SIZE;
    optionsBuffer[IDX_OPTIONS_MAX_DEFLATE_DYNAMIC_TABLE_SIZE] = options.maxDeflateDynamicTableSize;
  }
  if (typeof options.maxReservedRemoteStreams === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_RESERVED_REMOTE_STREAMS;
    optionsBuffer[IDX_OPTIONS_MAX_RESERVED_REMOTE_STREAMS] = options.maxReservedRemoteStreams;
  }
  if (typeof options.maxSendHeaderBlockLength === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_SEND_HEADER_BLOCK_LENGTH;
    optionsBuffer[IDX_OPTIONS_MAX_SEND_HEADER_BLOCK_LENGTH] = options.maxSendHeaderBlockLength;
  }
  if (typeof options.peerMaxConcurrentStreams === "number") {
    flags |= 1 << IDX_OPTIONS_PEER_MAX_CONCURRENT_STREAMS;
    optionsBuffer[IDX_OPTIONS_PEER_MAX_CONCURRENT_STREAMS] = options.peerMaxConcurrentStreams;
  }
  if (typeof options.paddingStrategy === "number") {
    flags |= 1 << IDX_OPTIONS_PADDING_STRATEGY;
    optionsBuffer[IDX_OPTIONS_PADDING_STRATEGY] = options.paddingStrategy;
  }
  if (typeof options.maxHeaderListPairs === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_HEADER_LIST_PAIRS;
    optionsBuffer[IDX_OPTIONS_MAX_HEADER_LIST_PAIRS] = options.maxHeaderListPairs;
  }
  if (typeof options.maxOutstandingPings === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_OUTSTANDING_PINGS;
    optionsBuffer[IDX_OPTIONS_MAX_OUTSTANDING_PINGS] = options.maxOutstandingPings;
  }
  if (typeof options.maxOutstandingSettings === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_OUTSTANDING_SETTINGS;
    optionsBuffer[IDX_OPTIONS_MAX_OUTSTANDING_SETTINGS] = MathMax(1, options.maxOutstandingSettings);
  }
  if (typeof options.maxSessionMemory === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_SESSION_MEMORY;
    optionsBuffer[IDX_OPTIONS_MAX_SESSION_MEMORY] = MathMax(1, options.maxSessionMemory);
  }
  if (typeof options.maxSettings === "number") {
    flags |= 1 << IDX_OPTIONS_MAX_SETTINGS;
    optionsBuffer[IDX_OPTIONS_MAX_SETTINGS] = MathMax(1, options.maxSettings);
  }
  if (typeof options.streamResetRate === "number") {
    flags |= 1 << IDX_OPTIONS_STREAM_RESET_RATE;
    optionsBuffer[IDX_OPTIONS_STREAM_RESET_RATE] = MathMax(1, options.streamResetRate);
  }
  if (typeof options.streamResetBurst === "number") {
    flags |= 1 << IDX_OPTIONS_STREAM_RESET_BURST;
    optionsBuffer[IDX_OPTIONS_STREAM_RESET_BURST] = MathMax(1, options.streamResetBurst);
  }
  if (typeof options.strictFieldWhitespaceValidation === "boolean") {
    flags |= 1 << IDX_OPTIONS_STRICT_HTTP_FIELD_WHITESPACE_VALIDATION;
    optionsBuffer[IDX_OPTIONS_STRICT_HTTP_FIELD_WHITESPACE_VALIDATION] =
      options.strictFieldWhitespaceValidation === true ? 0 : 1;
  }
  optionsBuffer[IDX_OPTIONS_FLAGS] = flags;
}

// Subset of nghttp2 library error codes used by Bun's frame parser.
// Matches nghttp2_strerror() so NghttpError gives the same messages as Node.
const kNghttp2ErrorMessages = {
  "-501": "Invalid argument",
  "-502": "Out of buffer space",
  "-503": "Unsupported SETTINGS frame version",
  "-504": "Server push is disabled by peer",
  "-505": "The user callback function failed due to the temporal error",
  "-506": "The length of the frame is invalid",
  "-507": "Invalid header block",
  "-509": "The stream is already closed; or the stream ID is invalid",
  "-510": "The stream is already closed; or the stream ID is invalid",
  "-511": "Stream ID has reached the maximum value",
  "-513": "Stream was reset",
  "-514": "Another DATA frame has already been deferred",
  "-515": "request HEADERS is not allowed",
  "-516": "GOAWAY has already been sent",
  "-519": "The transmission is not allowed for this stream",
  "-521": "Invalid stream ID",
  "-522": "The length of the frame is invalid",
  "-523": "Header block inflate/deflate error",
  "-524": "Flow control error",
  "-525": "Insufficient buffer size given to function",
  "-526": "Callback was paused by the application",
  "-527": "Too many inflight SETTINGS",
  "-528": "Server push is disabled by peer",
  "-529": "DATA or HEADERS frame for a given stream has been already submitted",
  "-530": "The current session is closing",
  "-531": "Invalid HTTP header field was received",
  "-532": "Violation in HTTP messaging rule",
  "-533": "Stream was refused",
  "-534": "Unexpected internal error",
  "-535": "Cancel",
  "-536": "When a local endpoint expects to receive SETTINGS frame, it receives an other type of frame",
  "-537": "SETTINGS frame contained more than the maximum allowed entries",
  "-538": "Too many CONTINUATION frames following a HEADER frame",
  "-900": "Out of memory",
  "-901": "The user callback function failed",
  "-902": "Received bad client magic byte string",
  "-903": "SETTINGS frame cannot be flooded",
  "-904": "Protocol error",
};

function nghttp2ErrorString(code) {
  return kNghttp2ErrorMessages[`${code}`] ?? "Unknown error code";
}

const kIsNodeError = Symbol("kIsNodeError");

class NghttpError extends Error {
  code: string;
  errno: number;
  constructor(integerCode: number, customErrorCode?: string) {
    super(customErrorCode ? String(customErrorCode) : nghttp2ErrorString(integerCode));
    this.code = customErrorCode || "ERR_HTTP2_ERROR";
    this.errno = integerCode;
  }

  get [kIsNodeError]() {
    return true;
  }

  toString() {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

function assertIsObject(value, name, types?) {
  if (value !== undefined && (value === null || typeof value !== "object" || ArrayIsArray(value))) {
    throw $ERR_INVALID_ARG_TYPE(name, types || "Object", value);
  }
}
hideFromStack(assertIsObject);

function assertIsArray(value, name, types?) {
  if (value !== undefined && (value === null || !ArrayIsArray(value))) {
    throw $ERR_INVALID_ARG_TYPE(name, types || "Array", value);
  }
}
hideFromStack(assertIsArray);

function assertWithinRange(name, value, min = 0, max = Infinity) {
  if (value !== undefined && (typeof value !== "number" || value < min || value > max)) {
    throw $ERR_HTTP2_INVALID_SETTING_VALUE_RangeError(`Invalid value for setting "${name}": ${value}`);
  }
}
hideFromStack(assertWithinRange);

function assertValidPseudoHeader(key) {
  if (!kValidPseudoHeaders.has(key)) {
    throw $ERR_HTTP2_INVALID_PSEUDOHEADER(key);
  }
}
hideFromStack(assertValidPseudoHeader);

function assertValidPseudoHeaderResponse(key) {
  if (key !== ":status") {
    throw $ERR_HTTP2_INVALID_PSEUDOHEADER(key);
  }
}
hideFromStack(assertValidPseudoHeaderResponse);

function assertValidPseudoHeaderTrailer(key) {
  throw $ERR_HTTP2_INVALID_PSEUDOHEADER(key);
}
hideFromStack(assertValidPseudoHeaderTrailer);

function isIllegalConnectionSpecificHeader(name, value) {
  switch (name) {
    case HTTP2_HEADER_CONNECTION:
    case HTTP2_HEADER_UPGRADE:
    case HTTP2_HEADER_HTTP2_SETTINGS:
    case HTTP2_HEADER_KEEP_ALIVE:
    case HTTP2_HEADER_PROXY_CONNECTION:
    case HTTP2_HEADER_TRANSFER_ENCODING:
      return true;
    case HTTP2_HEADER_TE:
      return value !== "trailers";
    default:
      return false;
  }
}

const emptyArray = [];
const kNeverIndexFlag = StringFromCharCode(NGHTTP2_NV_FLAG_NO_INDEX);
const kNoHeaderFlags = StringFromCharCode(NGHTTP2_NV_FLAG_NONE);

// Builds an NgHeader string + header count value, validating the header key
// format, rejecting illegal header configurations, and marking sensitive
// headers that should not be indexed en route. Takes either a flat array of
// raw headers ([k1, v1, k2, v2]) or a header object ({ k1: v1, k2: [v2, v3] }).
function buildNgHeaderString(arrayOrMap, validatePseudoHeaderValue = assertValidPseudoHeader, strictSingleValueFields = true) {
  let headers = "";
  let pseudoHeaders = "";
  let count = 0;

  const singles = new SafeSet();
  const sensitive = arrayOrMap[kSensitiveHeaders] || emptyArray;
  const neverIndex = sensitive.map(v => v.toLowerCase());

  function processHeader(key, value) {
    key = key.toLowerCase();
    const isStrictSingleValueField = strictSingleValueFields && kSingleValueHeaders.has(key);
    let isArray = ArrayIsArray(value);
    if (isArray) {
      switch (value.length) {
        case 0:
          return;
        case 1:
          value = String(value[0]);
          isArray = false;
          break;
        default:
          if (isStrictSingleValueField) {
            throw $ERR_HTTP2_HEADER_SINGLE_VALUE(`Header field "${key}" must only have a single value`);
          }
      }
    } else {
      value = String(value);
    }
    if (isStrictSingleValueField) {
      if (singles.has(key)) {
        throw $ERR_HTTP2_HEADER_SINGLE_VALUE(`Header field "${key}" must only have a single value`);
      }
      singles.add(key);
    }
    const flags = neverIndex.includes(key) ? kNeverIndexFlag : kNoHeaderFlags;
    if (key[0] === ":") {
      const err = validatePseudoHeaderValue(key);
      if (err !== undefined) throw err;
      pseudoHeaders += `${key}\0${value}\0${flags}`;
      count++;
      return;
    }
    if (!checkIsHttpToken(key)) {
      throw $ERR_INVALID_HTTP_TOKEN("Header name", key);
    }
    if (isIllegalConnectionSpecificHeader(key, value)) {
      throw $ERR_HTTP2_INVALID_CONNECTION_HEADERS(`HTTP/1 Connection specific headers are forbidden: "${key}"`);
    }
    if (isArray) {
      for (let j = 0; j < value.length; ++j) {
        const val = String(value[j]);
        headers += `${key}\0${val}\0${flags}`;
      }
      count += value.length;
      return;
    }
    headers += `${key}\0${value}\0${flags}`;
    count++;
  }

  if (ArrayIsArray(arrayOrMap)) {
    for (let i = 0; i < arrayOrMap.length; i += 2) {
      const key = arrayOrMap[i];
      const value = arrayOrMap[i + 1];
      if (value === undefined || key === "") continue;
      processHeader(key, value);
    }
  } else {
    const keys = ObjectKeys(arrayOrMap);
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      const value = arrayOrMap[key];
      if (value === undefined || key === "") continue;
      processHeader(key, value);
    }
  }

  return [pseudoHeaders + headers, count];
}

function toHeaderObject(headers, sensitiveHeadersValue?) {
  const obj = { __proto__: null };
  for (let n = 0; n < headers.length; n += 2) {
    const name = headers[n];
    let value = headers[n + 1];
    if (value === undefined) value = "";
    if (name === HTTP2_HEADER_STATUS) value |= 0;
    const existing = obj[name];
    if (existing === undefined) {
      obj[name] = name === HTTP2_HEADER_SET_COOKIE ? [value] : value;
    } else if (!kSingleValueHeaders.has(name)) {
      switch (name) {
        case HTTP2_HEADER_COOKIE:
          // https://tools.ietf.org/html/rfc7540#section-8.1.2.5
          obj[name] = `${existing}; ${value}`;
          break;
        case HTTP2_HEADER_SET_COOKIE:
          // https://tools.ietf.org/html/rfc7230#section-3.2.2
          ArrayPrototypePush.$call(existing, value);
          break;
        default:
          // https://tools.ietf.org/html/rfc7230#section-3.2.2
          obj[name] = `${existing}, ${value}`;
          break;
      }
    }
  }
  obj[kSensitiveHeaders] = sensitiveHeadersValue;
  return obj;
}

function isPayloadMeaningless(method) {
  return kNoPayloadMethods.has(method);
}

function sessionName(type) {
  switch (type) {
    case NGHTTP2_SESSION_CLIENT:
      return "client";
    case NGHTTP2_SESSION_SERVER:
      return "server";
    default:
      return "<invalid>";
  }
}

function getAuthority(headers) {
  // For non-CONNECT requests, HTTP/2 allows either :authority
  // or Host to be used equivalently. The first is preferred
  // when making HTTP/2 requests, and the latter is preferred
  // when converting from an HTTP/1 message.
  if (headers[HTTP2_HEADER_AUTHORITY] !== undefined) return headers[HTTP2_HEADER_AUTHORITY];
  if (headers[HTTP2_HEADER_HOST] !== undefined) return headers[HTTP2_HEADER_HOST];
}

export default {
  assertIsObject,
  assertIsArray,
  assertValidPseudoHeader,
  assertValidPseudoHeaderResponse,
  assertValidPseudoHeaderTrailer,
  assertWithinRange,
  buildNgHeaderString,
  constants,
  getAuthority,
  isIllegalConnectionSpecificHeader,
  isPayloadMeaningless,
  kAuthority,
  kNoPayloadMethods,
  kProtocol,
  kProxySocket,
  kRequest,
  kSensitiveHeaders,
  kSingleValueHeaders,
  kSocket,
  kValidPseudoHeaders,
  MAX_ADDITIONAL_SETTINGS,
  NghttpError,
  nghttp2ErrorString,
  optionsBuffer,
  sessionName,
  toHeaderObject,
  updateOptionsBuffer,
};
