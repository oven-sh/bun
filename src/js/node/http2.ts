// Hardcoded module "node:http2"
/*
 * Portions of this code are derived from the Node.js project (https://nodejs.org/),
 * originally developed by Node.js contributors and Joyent, Inc.
 *
 * Copyright Node.js contributors. All rights reserved.
 * Copyright Joyent, Inc. and other Node contributors. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Modifications were made to the original code.
 */
const { isTypedArray } = require("node:util/types");
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const { STATUS_CODES } = require("internal/http");
const { kTimeout, getTimerDuration } = require("internal/timers");
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const { $data } = require("node:fs/promises");
const FileHandle = $data.FileHandle;
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const kInfoHeaders = Symbol("sent-info-headers");
const kStrictSingleValueFields = Symbol("strictSingleValueFields");
const kDeferWriteCallback = Symbol("deferWriteCallback");
const kProxySocket = Symbol("proxySocket");
const kSessions = Symbol("sessions");
const kOptions = Symbol("options");
const kHttp1Connections = Symbol("http1Connections");
const kHttp1ActiveRequests = Symbol("http1ActiveRequests");
const kQuotedString = /^[\x09\x20-\x5b\x5d-\x7e\x80-\xff]*$/;
const MAX_ADDITIONAL_SETTINGS = 10;
const Stream = require("node:stream");
const dc = require("node:diagnostics_channel");

// Built-in HTTP/2 diagnostics channels (mirror node's lib/internal/http2/core.js).
const onClientStreamCreatedChannel = dc.channel("http2.client.stream.created");
const onClientStreamStartChannel = dc.channel("http2.client.stream.start");
const onClientStreamErrorChannel = dc.channel("http2.client.stream.error");
const onClientStreamBodyChunkSentChannel = dc.channel("http2.client.stream.bodyChunkSent");
const onClientStreamBodySentChannel = dc.channel("http2.client.stream.bodySent");
const onClientStreamFinishChannel = dc.channel("http2.client.stream.finish");
const onClientStreamCloseChannel = dc.channel("http2.client.stream.close");
const onServerStreamCreatedChannel = dc.channel("http2.server.stream.created");
const onServerStreamStartChannel = dc.channel("http2.server.stream.start");
const onServerStreamErrorChannel = dc.channel("http2.server.stream.error");
const onServerStreamFinishChannel = dc.channel("http2.server.stream.finish");
const onServerStreamCloseChannel = dc.channel("http2.server.stream.close");
const { Readable } = Stream;
type Http2ConnectOptions = {
  settings?: Settings;
  protocol?: "https:" | "http:";
  createConnection?: Function;
};
const TLSSocket = tls.TLSSocket;
const Socket = net.Socket;
const EventEmitter = require("node:events");
const { Duplex } = Stream;
const { SafeArrayIterator, SafeSet } = require("internal/primordials");
const { promisify } = require("internal/promisify");

const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;
const ArrayIsArray = Array.isArray;
const ObjectKeys = Object.keys;
const FunctionPrototypeBind = Function.prototype.bind;
const StringPrototypeTrim = String.prototype.trim;
const ArrayPrototypePush = Array.prototype.push;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeStartsWith = String.prototype.startsWith;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const DatePrototypeToUTCString = Date.prototype.toUTCString;
const DatePrototypeGetMilliseconds = Date.prototype.getMilliseconds;

const H2FrameParser = $rust("h2_frame_parser.rs", "H2FrameParserConstructor");
const _nativeAssertSettings = $newRustFunction("h2_frame_parser.rs", "jsAssertSettings", 1);
const { upgradeRawSocketToH2 } = require("node:_http2_upgrade");

const kSettingNames = {
  headerTableSize: 0x1,
  enablePush: 0x2,
  maxConcurrentStreams: 0x3,
  initialWindowSize: 0x4,
  maxFrameSize: 0x5,
  maxHeaderListSize: 0x6,
  enableConnectProtocol: 0x8,
};

const kSettingIds: Record<number, string> = {
  0x1: "headerTableSize",
  0x2: "enablePush",
  0x3: "maxConcurrentStreams",
  0x4: "initialWindowSize",
  0x5: "maxFrameSize",
  0x6: "maxHeaderListSize",
  0x8: "enableConnectProtocol",
};

const kDefaultSettings = {
  headerTableSize: 4096,
  enablePush: true,
  maxConcurrentStreams: 2 ** 32 - 1,
  initialWindowSize: 65535,
  maxFrameSize: 16384,
  maxHeaderListSize: 65535,
  maxHeaderSize: 65535,
  enableConnectProtocol: false,
};

// Pre-ACK localSettings view: node's getSettings() reads nghttp2's effective local settings
// (protocol defaults until the first ACK) but carries submitted customSettings forward from
// the SETTINGS frame buffer, so only customSettings is visible pre-ACK.
function initialLocalSettings(submitted: any) {
  const settings: any = { ...kDefaultSettings };
  const custom = submitted?.customSettings;
  if (custom != null && typeof custom === "object") {
    settings.customSettings = { ...custom };
  }
  return settings;
}

function throwSettingRangeError(name: string, value: any) {
  const err = new RangeError(`Invalid value for setting "${name}": ${value}`);
  (err as any).code = "ERR_HTTP2_INVALID_SETTING_VALUE";
  throw err;
}

function throwSettingTypeError(name: string, value: any) {
  const err = new TypeError(`Invalid value for setting "${name}": ${value}`);
  (err as any).code = "ERR_HTTP2_INVALID_SETTING_VALUE";
  throw err;
}

function validateSettings(settings: any) {
  if (typeof settings !== "object" || settings === null || $isArray(settings)) {
    throw $ERR_INVALID_ARG_TYPE("settings", "object", settings);
  }

  if (settings.headerTableSize !== undefined) {
    const v = settings.headerTableSize;
    if (typeof v !== "number" || v < 0 || v > kMaxInt || Number.isNaN(v)) {
      throwSettingRangeError("headerTableSize", v);
    }
  }

  if (settings.enablePush !== undefined) {
    const v = settings.enablePush;
    if (typeof v !== "boolean") {
      throwSettingTypeError("enablePush", v);
    }
  }

  if (settings.initialWindowSize !== undefined) {
    const v = settings.initialWindowSize;
    // RFC 9113 6.5.2: the maximum flow-control window is 2^31-1 (kMaxInt is 2^32-1 here).
    if (typeof v !== "number" || v < 0 || v > 2147483647 || Number.isNaN(v)) {
      throwSettingRangeError("initialWindowSize", v);
    }
  }

  if (settings.maxFrameSize !== undefined) {
    const v = settings.maxFrameSize;
    if (typeof v !== "number" || v < 16384 || v > 16777215 || Number.isNaN(v)) {
      throwSettingRangeError("maxFrameSize", v);
    }
  }

  if (settings.maxConcurrentStreams !== undefined) {
    const v = settings.maxConcurrentStreams;
    if (typeof v !== "number" || v < 0 || v > kMaxInt || Number.isNaN(v)) {
      throwSettingRangeError("maxConcurrentStreams", v);
    }
  }

  if (settings.maxHeaderListSize !== undefined) {
    const v = settings.maxHeaderListSize;
    if (typeof v !== "number" || v < 0 || v > kMaxInt || Number.isNaN(v)) {
      throwSettingRangeError("maxHeaderListSize", v);
    }
  }

  if (settings.maxHeaderSize !== undefined) {
    const v = settings.maxHeaderSize;
    if (typeof v !== "number" || v < 0 || v > kMaxInt || Number.isNaN(v)) {
      throwSettingRangeError("maxHeaderSize", v);
    }
  }

  if (settings.enableConnectProtocol !== undefined) {
    const v = settings.enableConnectProtocol;
    if (typeof v !== "boolean") {
      throwSettingTypeError("enableConnectProtocol", v);
    }
  }

  if (settings.customSettings !== undefined) {
    const cs = settings.customSettings;
    if (typeof cs !== "object" || cs === null) {
      throwSettingRangeError("customSettings", cs);
    }
    const keys = ObjectKeys(cs);
    if (keys.length > MAX_ADDITIONAL_SETTINGS) {
      const err = new Error("Number of custom settings exceeds MAX_ADDITIONAL_SETTINGS");
      (err as any).code = "ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS";
      throw err;
    }
    for (const key of keys) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0 || id > 0xffff) {
        throwSettingRangeError(key, cs[key]);
      }
      const val = cs[key];
      if (typeof val !== "number" || val < 0 || val > kMaxInt || !Number.isFinite(val)) {
        throwSettingRangeError(key, val);
      }
    }
  }
}

function assertSettings(settings: any) {
  validateSettings(settings);
}

function getPackedSettings(settings?: any): Buffer {
  if (settings === undefined) return Buffer.alloc(0);
  validateSettings(settings);

  const entries: Array<[number, number]> = [];

  if (settings.headerTableSize !== undefined) {
    entries.push([0x1, settings.headerTableSize]);
  }
  if (settings.enablePush !== undefined) {
    entries.push([0x2, settings.enablePush ? 1 : 0]);
  }
  if (settings.maxConcurrentStreams !== undefined) {
    entries.push([0x3, settings.maxConcurrentStreams]);
  }
  if (settings.initialWindowSize !== undefined) {
    entries.push([0x4, settings.initialWindowSize]);
  }
  if (settings.maxFrameSize !== undefined) {
    entries.push([0x5, settings.maxFrameSize]);
  }
  if (settings.maxHeaderListSize !== undefined) {
    entries.push([0x6, settings.maxHeaderListSize]);
  } else if (settings.maxHeaderSize !== undefined) {
    entries.push([0x6, settings.maxHeaderSize]);
  }
  if (settings.enableConnectProtocol !== undefined) {
    entries.push([0x8, settings.enableConnectProtocol ? 1 : 0]);
  }
  if (settings.customSettings) {
    const cs = settings.customSettings;
    const keys = ObjectKeys(cs);
    // Sort custom settings by ID for consistent output
    keys.sort((a, b) => Number(a) - Number(b));
    for (const key of keys) {
      entries.push([Number(key), cs[key]]);
    }
  }

  const buf = Buffer.alloc(entries.length * 6);
  for (let i = 0; i < entries.length; i++) {
    const offset = i * 6;
    buf.writeUInt16BE(entries[i][0], offset);
    buf.writeUInt32BE(entries[i][1], offset + 2);
  }
  return buf;
}

function getUnpackedSettings(buf?: any, options?: any): any {
  if (buf === undefined) {
    return { ...kDefaultSettings };
  }

  if (!Buffer.isBuffer(buf) && !isTypedArray(buf)) {
    {
      // node renders this as instance-of (class names), not of-type.
      const err = new TypeError(
        `The "buf" argument must be an instance of Buffer or TypedArray. Received ` + receivedValueLabel(buf),
      );
      err.code = "ERR_INVALID_ARG_TYPE";
      throw err;
    }
  }

  if (buf.length % 6 !== 0) {
    const err = new RangeError("Packed settings length must be a multiple of six");
    (err as any).code = "ERR_HTTP2_INVALID_PACKED_SETTINGS_LENGTH";
    throw err;
  }

  const settings: any = {};
  const customSettings: Record<string, number> = {};
  let hasCustom = false;

  // Use element-by-element access so it works for both Buffer and TypedArrays.
  // For Buffer, buf[i] returns a byte. For Uint16Array etc., buf[i] returns
  // the i-th element. Node.js reads settings this way too.
  for (let i = 0; i < buf.length; i += 6) {
    const type = buf[i] * 256 + buf[i + 1];
    const value = ((buf[i + 2] << 24) | (buf[i + 3] << 16) | (buf[i + 4] << 8) | buf[i + 5]) >>> 0;

    const name = kSettingIds[type];
    if (name) {
      if (name === "enablePush") {
        settings[name] = value !== 0;
      } else if (name === "enableConnectProtocol") {
        settings[name] = value !== 0;
      } else {
        settings[name] = value;
      }
      if (name === "maxHeaderListSize") {
        settings.maxHeaderSize = value;
      }
    } else {
      customSettings[String(type)] = value;
      hasCustom = true;
    }
  }

  if (hasCustom) {
    settings.customSettings = customSettings;
  }

  if (options && options.validate) {
    validateSettings(settings);
  }

  return settings;
}

const sensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");
const bunHTTP2Native = Symbol.for("::bunhttp2native::");

const bunHTTP2Socket = Symbol.for("::bunhttp2socket::");
const bunHTTP2OriginSet = Symbol("::bunhttp2originset::");
const bunHTTP2StreamFinal = Symbol.for("::bunHTTP2StreamFinal::");
const bunHTTP2WaitForTrailers = Symbol("::bunhttp2waitfortrailers::");

const bunHTTP2StreamStatus = Symbol.for("::bunhttp2StreamStatus::");

const bunHTTP2Session = Symbol.for("::bunhttp2session::");
const bunHTTP2Headers = Symbol.for("::bunhttp2headers::");
const bunHTTP2AsyncContextFrame = Symbol("::bunhttp2asynccontextframe::");
const bunHTTP2SessionTeardownFrame = Symbol("::bunhttp2sessionteardownframe::");
// Sentinel for bunHTTP2SessionTeardownFrame: a captured frame can itself be
// undefined (the root context), so "no teardown in progress" needs its own value.
const kNoSessionTeardown = Symbol("::bunhttp2noteardown::");
const runInFrame = require("internal/async_context_frame").run;

const ReflectGetPrototypeOf = Reflect.getPrototypeOf;

const kBeginSend = Symbol("begin-send");
const kServer = Symbol("server");
const kState = Symbol("state");
const kStream = Symbol("stream");
const kResponse = Symbol("response");
const kHeaders = Symbol("headers");
const kRawHeaders = Symbol("rawHeaders");
const kTrailers = Symbol("trailers");
const kRawTrailers = Symbol("rawTrailers");
const kSetHeader = Symbol("setHeader");
const kAppendHeader = Symbol("appendHeader");
const kAborted = Symbol("aborted");
const kSetStreamId = Symbol("setStreamId");
const kRequest = Symbol("request");
const kHeadRequest = Symbol("headRequest");
const kSessionDestroyError = Symbol("sessionDestroyError");
// Set on a ServerHttp2Stream by respondWithFile(): the stream opened the descriptor itself and is
// responsible for closing it exactly once. respondWithFD() descriptors belong to the caller.
const kOwnsFd = Symbol("ownsFd");
const kRequestHeaders = Symbol("requestHeaders");
// True only for the synchronous extent of Http2Stream#sendTrailers()'s native call. node submits
// trailers on a later turn (finishSendTrailers via setImmediate), so a stream never observes its
// own close from inside sendTrailers() — the streamEnd(closed) dispatch is re-queued when this is
// set so a second sendTrailers() in the same tick reports ERR_HTTP2_TRAILERS_ALREADY_SENT, not
// ERR_HTTP2_INVALID_STREAM.
const kSendingTrailers = Symbol("sendingTrailers");
const kSettingsAckGraceTimer = Symbol("settingsAckGraceTimer");
// node: a socket can be bound to at most one Http2Session (ERR_HTTP2_SOCKET_BOUND).
const kBoundSession = Symbol("boundSession");
const kInspect = Symbol.for("nodejs.util.inspect.custom");
let util; // lazy node:util (only needed for the custom inspect output)
let addAbortListener; // lazy internal/abort_listener
let priorityDeprecationWarned = false;
// DEP0194 for the request `weight` option (distinct from the Http2Stream#priority() warning above).
let priorityWeightDeprecationWarned = false;
// Marks a client stream created from a received PUSH_PROMISE: its response HEADERS fire 'push'.
const kPush = Symbol("pushStream");
const kNeverAnnounced = Symbol("neverAnnounced");
const kReceivedGoaway = Symbol("receivedGoaway");
// The error code carried by a received GOAWAY; like Node's state.goawayCode it
// takes precedence over the destroy code when streams are torn down.
const kGoawayCode = Symbol("goawayCode");
const kReleaseUnannouncedStream = Symbol("releaseUnannouncedStream");
const kGoawaySent = Symbol("goawaySent");

// Node's socketOnError: once a GOAWAY has been received the peer is fully
// within its rights to drop the connection, so an ECONNRESET behind it is
// teardown, not an error - the session is destroyed without one. Whether the
// RST is actually observed is timing- and platform-dependent (routine on
// Windows loopback), so this must not depend on 'error' listener count.
function isEconnresetAfterGoaway(session, error: Error): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ECONNRESET" && session[kGoawayCode] !== undefined;
}
const kMaxStreams = 2 ** 32 - 1;
const kMaxUint32 = 4294967295;
const kMaxInt = 4294967295;
const kMaxWindowSize = 2 ** 31 - 1;
const {
  validateInteger,
  validateString,
  validateObject,
  validateFunction,
  checkIsHttpToken,
  validateLinkHeaderValue,
  validateUint32,
  validateBuffer,
  validateNumber,
  validateBoolean,
  validateAbortSignal,
} = require("internal/validators");

let utcCache;

function utcDate() {
  if (!utcCache) cache();
  return utcCache;
}
function emitEventNT(self: any, event: string, ...args: any[]) {
  if (self.listenerCount(event) > 0) {
    self.emit(event, ...args);
  }
}
// The frame is passed in: destroy() clears it off the session before emitting
// 'error', so a throwing listener on either event cannot leave a retained
// session pinning the store.
function emitSessionCloseNT(self: Http2Session, frame) {
  if (self.listenerCount("close") > 0) {
    runInFrame(frame, self.emit, self, "close");
  }
}
function emitErrorNT(self: any, error: any, destroy: boolean) {
  if (destroy) {
    if (self.listenerCount("error") > 0) {
      self.destroy(error);
    } else {
      self.destroy();
    }
  } else if (self.listenerCount("error") > 0) {
    self.emit("error", error);
  }
}

function emitOutofStreamErrorNT(self: any) {
  self.destroy($ERR_HTTP2_OUT_OF_STREAMS());
}
function cache() {
  const d = new Date();
  utcCache = d.toUTCString();
  setTimeout(resetCache, 1000 - d.getMilliseconds()).unref();
}

function resetCache() {
  utcCache = undefined;
}

function getAuthority(headers) {
  // For non-CONNECT requests, HTTP/2 allows either :authority
  // or Host to be used equivalently. The first is preferred
  // when making HTTP/2 requests, and the latter is preferred
  // when converting from an HTTP/1 message.
  if (headers[HTTP2_HEADER_AUTHORITY] !== undefined) return headers[HTTP2_HEADER_AUTHORITY];
  if (headers[HTTP2_HEADER_HOST] !== undefined) return headers[HTTP2_HEADER_HOST];
}
function onStreamData(chunk) {
  const request = this[kRequest];
  if (request !== undefined && !request.push(chunk)) this.pause();
}

function onStreamTrailers(trailers, flags, rawTrailers) {
  const request = this[kRequest];
  if (request !== undefined) {
    ObjectAssign(request[kTrailers], trailers);
    ArrayPrototypePush.$call(request[kRawTrailers], ...new SafeArrayIterator(rawTrailers));
  }
}

function onStreamEnd() {
  // Cause the request stream to end as well.
  const request = this[kRequest];
  if (request !== undefined) this[kRequest].push(null);
}

function onStreamError(error) {
  // This is purposefully left blank
  //
  // errors in compatibility mode are
  // not forwarded to the request
  // and response objects.
}

function onRequestPause() {
  this[kStream].pause();
}

function onRequestResume() {
  this[kStream].resume();
}

function onStreamDrain() {
  const response = this[kResponse];
  if (response !== undefined) response.emit("drain");
}

function onStreamAbortedResponse() {
  // no-op for now
}

function onStreamAbortedRequest() {
  const request = this[kRequest];
  if (request !== undefined && request[kState].closed === false) {
    request[kAborted] = true;
    request.emit("aborted");
  }
}

function resumeStream(stream) {
  stream.resume();
}

function onStreamTrailersReady() {
  this.sendTrailers(this[kResponse][kTrailers]);
}

function onStreamCloseResponse() {
  const res = this[kResponse];
  if (res === undefined) return;

  const state = res[kState];

  if (this.headRequest !== state.headRequest) return;

  state.closed = true;

  this.removeListener("wantTrailers", onStreamTrailersReady);
  this[kResponse] = undefined;
  res.emit("finish");

  res.emit("close");
}
function onStreamCloseRequest() {
  const req = this[kRequest];

  if (req === undefined) return;

  const state = req[kState];
  state.closed = true;

  req.push(null);
  // If the user didn't interact with incoming data and didn't pipe it,
  // dump it for compatibility with http1
  if (!state.didRead && !req._readableState.resumeScheduled) req.resume();

  this[kRequest] = undefined;

  req.emit("close");
}

function onStreamTimeout() {
  this.emit("timeout");
}

function isPseudoHeader(name) {
  switch (name) {
    case HTTP2_HEADER_STATUS: // :status
    case HTTP2_HEADER_METHOD: // :method
    case HTTP2_HEADER_PATH: // :path
    case HTTP2_HEADER_AUTHORITY: // :authority
    case HTTP2_HEADER_SCHEME: // :scheme
      return true;
    default:
      return false;
  }
}

function isConnectionHeaderAllowed(name, value) {
  return name !== HTTP2_HEADER_CONNECTION || value === "trailers";
}
let statusConnectionHeaderWarned = false;
let statusMessageWarned = false;
function statusMessageWarn() {
  if (statusMessageWarned === false) {
    process.emitWarning("Status message is not supported by HTTP/2 (RFC7540 8.1.2.4)", "UnsupportedWarning");
    statusMessageWarned = true;
  }
}

function connectionHeaderMessageWarn() {
  if (statusConnectionHeaderWarned === false) {
    process.emitWarning(
      "The provided connection header is not valid, " +
        "the value will be dropped from the header and " +
        "will never be in use.",
      "UnsupportedWarning",
    );
    statusConnectionHeaderWarned = true;
  }
}

function assertValidHeader(name, value) {
  if (name === "" || typeof name !== "string" || StringPrototypeIncludes.$call(name, " ")) {
    throw $ERR_INVALID_HTTP_TOKEN("Header name", name);
  }
  if (isPseudoHeader(name)) {
    throw $ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED();
  }
  if (value === undefined || value === null) {
    throw $ERR_HTTP2_INVALID_HEADER_VALUE(value, name);
  }
  if (!isConnectionHeaderAllowed(name, value)) {
    connectionHeaderMessageWarn();
  }
}
function assertIsObject(value: any, name: string, types?: string | string[]): asserts value is object {
  if (value !== undefined && (!$isObject(value) || $isArray(value))) {
    throw $ERR_INVALID_ARG_TYPE(name, $isArray(types) ? types : [types || "Object"], value);
  }
}

function assertIsArray(value: any, name: string, types?: string | string[]): asserts value is any[] {
  if (value !== undefined && !$isArray(value)) {
    throw $ERR_INVALID_ARG_TYPE(name, $isArray(types) ? types : [types || "Array"], value);
  }
}
hideFromStack(assertIsObject);
hideFromStack(assertIsArray);
hideFromStack(assertValidHeader);

class Http2ServerRequest extends Readable {
  [kState];
  [kHeaders];
  [kRawHeaders];
  [kTrailers];
  [kRawTrailers];
  [kStream];
  [kAborted];

  constructor(stream, headers, options, rawHeaders) {
    super({ autoDestroy: false, ...options });
    this[kState] = {
      closed: false,
      didRead: false,
    };
    // Headers in HTTP/1 are not initialized using Object.create(null) which,
    // although preferable, would simply break too much code. Ergo header
    // initialization using Object.create(null) in HTTP/2 is intentional.
    this[kHeaders] = headers;
    this[kRawHeaders] = rawHeaders;
    this[kTrailers] = {};
    this[kRawTrailers] = [];
    this[kStream] = stream;
    this[kAborted] = false;
    stream[kRequest] = this;

    // Pause the stream..
    stream.on("trailers", onStreamTrailers);
    stream.on("end", onStreamEnd);
    stream.on("error", onStreamError);
    stream.on("aborted", onStreamAbortedRequest);
    stream.on("close", onStreamCloseRequest);
    stream.on("timeout", onStreamTimeout.bind(this));
    this.on("pause", onRequestPause);
    this.on("resume", onRequestResume);
  }

  get aborted() {
    return this[kAborted];
  }

  get complete() {
    return this[kAborted] || this.readableEnded || this[kState].closed || this[kStream].destroyed;
  }

  get stream() {
    return this[kStream];
  }

  get headers() {
    return this[kHeaders];
  }

  get rawHeaders() {
    return this[kRawHeaders];
  }

  get trailers() {
    return this[kTrailers];
  }

  get rawTrailers() {
    return this[kRawTrailers];
  }

  get httpVersionMajor() {
    return 2;
  }

  get httpVersionMinor() {
    return 0;
  }

  get httpVersion() {
    return "2.0";
  }

  get socket() {
    const stream = this[kStream];
    const proxySocket = stream[kProxySocket];
    if (proxySocket == null) return (stream[kProxySocket] = new Proxy(stream, proxyCompatSocketHandler));
    return proxySocket;
  }

  get connection() {
    return this.socket;
  }

  _read(nread) {
    const state = this[kState];
    if (!state.didRead) {
      state.didRead = true;
      this[kStream].on("data", onStreamData);
    } else {
      process.nextTick(resumeStream, this[kStream]);
    }
  }

  get method() {
    return this[kHeaders][HTTP2_HEADER_METHOD];
  }

  set method(method) {
    validateString(method, "method");
    if (StringPrototypeTrim.$call(method) === "") throw $ERR_INVALID_ARG_VALUE("method", method);
    this[kHeaders][HTTP2_HEADER_METHOD] = method;
  }

  get authority() {
    return getAuthority(this[kHeaders]);
  }

  get scheme() {
    return this[kHeaders][HTTP2_HEADER_SCHEME];
  }

  get url() {
    return this[kHeaders][HTTP2_HEADER_PATH];
  }

  set url(url) {
    this[kHeaders][HTTP2_HEADER_PATH] = url;
  }

  setTimeout(msecs, callback) {
    if (!this[kState].closed) this[kStream].setTimeout(msecs, callback);
    return this;
  }
}
class Http2ServerResponse extends Stream {
  [kState];
  [kHeaders];
  [kTrailers];
  [kStream];

  constructor(stream, options?) {
    super(options);
    this[kState] = {
      closed: false,
      ending: false,
      destroyed: false,
      headRequest: false,
      sendDate: true,
      statusCode: HTTP_STATUS_OK,
    };
    this[kHeaders] = Object.create(null);
    this[kTrailers] = Object.create(null);
    this[kStream] = stream;
    stream[kResponse] = this;
    this.writable = true;
    this.req = stream[kRequest];
    stream.on("drain", onStreamDrain);
    stream.on("aborted", onStreamAbortedResponse);
    stream.on("close", onStreamCloseResponse);
    stream.on("wantTrailers", onStreamTrailersReady);
    stream.on("timeout", onStreamTimeout.bind(this));
  }

  // User land modules such as finalhandler just check truthiness of this
  // but if someone is actually trying to use this for more than that
  // then we simply can't support such use cases
  get _header() {
    return this.headersSent;
  }

  get writableEnded() {
    const state = this[kState];
    return state.ending;
  }

  get finished() {
    const state = this[kState];
    return state.ending;
  }

  get socket() {
    // This is compatible with http1 which removes socket reference
    // only from ServerResponse but not IncomingMessage
    if (this[kState].closed) return undefined;
    const stream = this[kStream];
    const proxySocket = stream[kProxySocket];
    if (proxySocket == null) return (stream[kProxySocket] = new Proxy(stream, proxyCompatSocketHandler));
    return proxySocket;
  }

  get connection() {
    return this.socket;
  }

  get stream() {
    return this[kStream];
  }

  get headersSent() {
    return this[kStream].headersSent;
  }

  get sendDate() {
    return this[kState].sendDate;
  }

  set sendDate(bool) {
    this[kState].sendDate = Boolean(bool);
  }

  get statusCode() {
    return this[kState].statusCode;
  }

  get writableCorked() {
    return this[kStream].writableCorked;
  }

  get writableHighWaterMark() {
    return this[kStream].writableHighWaterMark;
  }

  get writableObjectMode() {
    return this[kStream].writableObjectMode;
  }

  get writableNeedDrain() {
    return this[kStream].writableNeedDrain;
  }

  get writableFinished() {
    return this[kStream].writableFinished;
  }

  get writableLength() {
    return this[kStream].writableLength;
  }

  set statusCode(code) {
    code |= 0;
    if (code >= 100 && code < 200) throw $ERR_HTTP2_INFO_STATUS_NOT_ALLOWED();
    if (code < 100 || code > 599) throw $ERR_HTTP2_STATUS_INVALID(code);
    this[kState].statusCode = code;
  }

  setTrailer(name, value) {
    validateString(name, "name");
    name = StringPrototypeToLowerCase.$call(StringPrototypeTrim.$call(name));
    assertValidHeader(name, value);
    this[kTrailers][name] = value;
  }

  addTrailers(headers) {
    const keys = ObjectKeys(headers);
    let key = "";
    for (let i = 0; i < keys.length; i++) {
      key = keys[i];
      this.setTrailer(key, headers[key]);
    }
  }

  getHeader(name) {
    validateString(name, "name");
    name = StringPrototypeToLowerCase.$call(StringPrototypeTrim.$call(name));
    return this[kHeaders][name];
  }

  getHeaderNames() {
    return ObjectKeys(this[kHeaders]);
  }

  getHeaders() {
    const headers = Object.create(null);
    return ObjectAssign(headers, this[kHeaders]);
  }

  hasHeader(name) {
    validateString(name, "name");
    name = StringPrototypeToLowerCase.$call(StringPrototypeTrim.$call(name));
    return ObjectPrototypeHasOwnProperty.$call(this[kHeaders], name);
  }

  removeHeader(name) {
    validateString(name, "name");
    if (this[kStream].headersSent) throw $ERR_HTTP2_HEADERS_SENT();

    name = StringPrototypeToLowerCase.$call(StringPrototypeTrim.$call(name));

    if (name === "date") {
      this[kState].sendDate = false;

      return;
    }

    delete this[kHeaders][name];
  }

  setHeader(name, value) {
    validateString(name, "name");
    if (this[kStream].headersSent) throw $ERR_HTTP2_HEADERS_SENT();

    this[kSetHeader](name, value);
  }

  [kSetHeader](name, value) {
    name = StringPrototypeToLowerCase.$call(StringPrototypeTrim.$call(name));
    assertValidHeader(name, value);

    if (!isConnectionHeaderAllowed(name, value)) {
      return;
    }

    if (name[0] === ":") assertValidPseudoHeader(name);
    else if (!checkIsHttpToken(name)) this.destroy($ERR_INVALID_HTTP_TOKEN("Header name", name));

    this[kHeaders][name] = value;
  }

  appendHeader(name, value) {
    validateString(name, "name");
    if (this[kStream].headersSent) throw $ERR_HTTP2_HEADERS_SENT();

    this[kAppendHeader](name, value);
  }

  [kAppendHeader](name, value) {
    name = StringPrototypeToLowerCase.$call(StringPrototypeTrim.$call(name));
    assertValidHeader(name, value);

    if (!isConnectionHeaderAllowed(name, value)) {
      return;
    }

    if (name[0] === ":") assertValidPseudoHeader(name);
    else if (!checkIsHttpToken(name)) this.destroy($ERR_INVALID_HTTP_TOKEN("Header name", name));

    // Handle various possible cases the same as OutgoingMessage.appendHeader:
    const headers = this[kHeaders];
    if (headers === null || !headers[name]) {
      return this.setHeader(name, value);
    }

    if (!ArrayIsArray(headers[name])) {
      headers[name] = [headers[name]];
    }

    const existingValues = headers[name];
    if (ArrayIsArray(value)) {
      for (let i = 0, length = value.length; i < length; i++) {
        existingValues.push(value[i]);
      }
    } else {
      existingValues.push(value);
    }
  }

  get statusMessage() {
    statusMessageWarn();

    return "";
  }

  set statusMessage(msg) {
    statusMessageWarn();
  }

  flushHeaders() {
    const state = this[kState];
    if (!state.closed && !this[kStream].headersSent) this.writeHead(state.statusCode);
  }

  writeHead(statusCode, statusMessage?, headers?) {
    const state = this[kState];

    // Node also bails on stream.closed: writeHead() after stream.close() must not send the
    // response HEADERS — the peer treats HEADERS on a stream it already saw end as a session
    // error (nghttp2 STREAM_CLOSED).
    if (state.closed || this.stream.destroyed || this.stream.closed) return this;
    if (this[kStream].headersSent) throw $ERR_HTTP2_HEADERS_SENT();

    if (typeof statusMessage === "string") statusMessageWarn();

    if (headers === undefined && typeof statusMessage === "object") headers = statusMessage;

    let i;
    if (ArrayIsArray(headers)) {
      if (this[kHeaders]) {
        // Headers in obj should override previous headers but still
        // allow explicit duplicates. To do so, we first remove any
        // existing conflicts, then use appendHeader. This is the
        // slow path, which only applies when you use setHeader and
        // then pass headers in writeHead too.

        // We need to handle both the tuple and flat array formats, just
        // like the logic further below.
        if (headers.length && ArrayIsArray(headers[0])) {
          for (let n = 0; n < headers.length; n += 1) {
            const key = headers[n + 0][0];
            this.removeHeader(key);
          }
        } else {
          for (let n = 0; n < headers.length; n += 2) {
            const key = headers[n + 0];
            this.removeHeader(key);
          }
        }
      }

      // Append all the headers provided in the array:
      if (headers.length && ArrayIsArray(headers[0])) {
        for (i = 0; i < headers.length; i++) {
          const header = headers[i];
          this[kAppendHeader](header[0], header[1]);
        }
      } else {
        if (headers.length % 2 !== 0) {
          throw $ERR_INVALID_ARG_VALUE("headers", headers);
        }

        for (i = 0; i < headers.length; i += 2) {
          this[kAppendHeader](headers[i], headers[i + 1]);
        }
      }
    } else if (typeof headers === "object") {
      const keys = ObjectKeys(headers);
      let key = "";
      for (i = 0; i < keys.length; i++) {
        key = keys[i];
        this[kSetHeader](key, headers[key]);
      }
    }

    state.statusCode = statusCode;
    this[kBeginSend]();

    return this;
  }

  cork() {
    this[kStream].cork();
  }

  uncork() {
    this[kStream].uncork();
  }

  write(chunk, encoding, cb?) {
    const state = this[kState];

    if (typeof encoding === "function") {
      cb = encoding;
      encoding = "utf8";
    }

    let err;
    if (state.ending) {
      err = $ERR_STREAM_WRITE_AFTER_END();
    } else if (state.closed) {
      err = $ERR_HTTP2_INVALID_STREAM();
    } else if (state.destroyed) {
      return false;
    }

    if (err) {
      if (typeof cb === "function") process.nextTick(cb, err);
      this.destroy(err);
      return false;
    }

    const stream = this[kStream];
    if (!stream.headersSent) this.writeHead(state.statusCode);
    return stream.write(chunk, encoding, cb);
  }

  end(chunk, encoding, cb) {
    const stream = this[kStream];
    const state = this[kState];

    if (typeof chunk === "function") {
      cb = chunk;
      chunk = null;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = "utf8";
    }

    if ((state.closed || state.ending) && state.headRequest === stream.headRequest) {
      if (typeof cb === "function") {
        process.nextTick(cb);
      }
      return this;
    }

    if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

    state.headRequest = stream.headRequest;
    state.ending = true;

    if (typeof cb === "function") {
      if (stream.writableEnded) this.once("finish", cb);
      else stream.once("finish", cb);
    }

    if (!stream.headersSent) this.writeHead(this[kState].statusCode);

    if (this[kState].closed || stream.destroyed) onStreamCloseResponse.$call(stream);
    else stream.end();

    return this;
  }

  destroy(err) {
    if (this[kState].destroyed) return;

    this[kState].destroyed = true;
    this[kStream].destroy(err);
  }

  setTimeout(msecs, callback) {
    if (this[kState].closed) return;
    this[kStream].setTimeout(msecs, callback);
  }

  createPushResponse(headers, callback) {
    validateFunction(callback, "callback");
    if (this[kState].closed) {
      const error = $ERR_HTTP2_INVALID_STREAM();
      process.nextTick(callback, error);
      return;
    }
    this[kStream].pushStream(headers, {}, (err, stream, headers, options) => {
      if (err) {
        callback(err);
        return;
      }
      callback(null, new Http2ServerResponse(stream));
    });
  }

  [kBeginSend]() {
    const state = this[kState];
    const headers = this[kHeaders];
    headers[HTTP2_HEADER_STATUS] = state.statusCode;
    const options = {
      endStream: state.ending,
      waitForTrailers: true,
      sendDate: state.sendDate,
    };
    this[kStream].respond(headers, options);
  }

  // TODO doesn't support callbacks
  writeContinue() {
    const stream = this[kStream];
    if (stream.headersSent || this[kState].closed) return false;
    stream.additionalHeaders({
      [HTTP2_HEADER_STATUS]: HTTP_STATUS_CONTINUE,
    });
    return true;
  }

  writeInformation(statusCode, headers) {
    if (
      typeof statusCode !== "number" ||
      (statusCode | 0) !== statusCode ||
      statusCode < 100 ||
      statusCode > 199 ||
      statusCode === 101
    ) {
      throw $ERR_HTTP2_STATUS_INVALID(statusCode);
    }
    const stream = this[kStream];
    if (stream.headersSent || this[kState].closed) return false;
    stream.additionalHeaders({
      ...(headers || {}),
      [HTTP2_HEADER_STATUS]: statusCode,
    });
    return true;
  }

  writeEarlyHints(hints) {
    validateObject(hints, "hints");
    const headers = Object.create(null);
    const linkHeaderValue = validateLinkHeaderValue(hints.link);
    for (const key of ObjectKeys(hints)) {
      if (key !== "link") {
        headers[key] = hints[key];
      }
    }
    if (linkHeaderValue.length === 0) {
      return false;
    }
    const stream = this[kStream];
    if (stream.headersSent || this[kState].closed) return false;
    stream.additionalHeaders({
      ...headers,
      [HTTP2_HEADER_STATUS]: HTTP_STATUS_EARLY_HINTS,
      "Link": linkHeaderValue,
    });
    return true;
  }
}

function onServerStream(Http2ServerRequest, Http2ServerResponse, stream, headers, flags, rawHeaders) {
  const server = this;
  const request = new Http2ServerRequest(stream, headers, undefined, rawHeaders);
  const response = new Http2ServerResponse(stream);

  // Check for the CONNECT method
  const method = headers[HTTP2_HEADER_METHOD];
  if (method === "CONNECT") {
    if (!server.emit("connect", request, response)) {
      response.statusCode = HTTP_STATUS_METHOD_NOT_ALLOWED;
      response.end();
    }
    return;
  }

  // Check for Expectations
  if (headers.expect !== undefined) {
    if (headers.expect === "100-continue") {
      if (server.listenerCount("checkContinue")) {
        server.emit("checkContinue", request, response);
      } else {
        response.writeContinue();
        server.emit("request", request, response);
      }
    } else if (server.listenerCount("checkExpectation")) {
      server.emit("checkExpectation", request, response);
    } else {
      response.statusCode = HTTP_STATUS_EXPECTATION_FAILED;
      response.end();
    }
    return;
  }

  server.emit("request", request, response);
}

// The h2 frame writer flushes through the native socket directly, bypassing the JS
// Writable accounting net.Socket's bytesWritten getter is built on — the native
// counter is the ground truth once frames hit the wire.
function socketBytesWritten(socket) {
  const native = socket._handle?.bytesWritten || 0;
  const js = socket.bytesWritten || 0;
  return native > js ? native : js;
}

const proxyCompatSocketHandler = {
  has(stream, prop) {
    const ref = stream.session !== undefined ? stream.session[bunHTTP2Socket] : stream;
    return prop in stream || prop in ref;
  },

  get(stream, prop) {
    switch (prop) {
      case "on":
      case "once":
      case "end":
      case "emit":
      case "destroy":
        return stream[prop].bind(stream);
      case "writable":
      case "destroyed":
        return stream[prop];
      case "readable": {
        if (stream.destroyed) return false;
        const request = stream[kRequest];
        return request ? request.readable : stream.readable;
      }
      case "setTimeout": {
        const session = stream.session;
        if (session !== undefined) return session.setTimeout.bind(session);
        return stream.setTimeout.bind(stream);
      }
      case "write":
      case "read":
      case "pause":
      case "resume":
        throw $ERR_HTTP2_NO_SOCKET_MANIPULATION();
      case "bytesWritten": {
        const ref = stream.session !== undefined ? stream.session[bunHTTP2Socket] : stream;
        return socketBytesWritten(ref);
      }
      default: {
        const ref = stream.session !== undefined ? stream.session[bunHTTP2Socket] : stream;
        const value = ref[prop];
        return typeof value === "function" ? value.bind(ref) : value;
      }
    }
  },
  getPrototypeOf(stream) {
    if (stream.session !== undefined) return ReflectGetPrototypeOf(stream.session[bunHTTP2Socket]);
    return ReflectGetPrototypeOf(stream);
  },
  set(stream, prop, value) {
    switch (prop) {
      case "writable":
      case "readable":
      case "destroyed":
      case "on":
      case "once":
      case "end":
      case "emit":
      case "destroy":
        stream[prop] = value;
        return true;
      case "setTimeout": {
        const session = stream.session;
        if (session !== undefined) session.setTimeout = value;
        else stream.setTimeout = value;
        return true;
      }
      case "write":
      case "read":
      case "pause":
      case "resume":
        throw $ERR_HTTP2_NO_SOCKET_MANIPULATION();
      default: {
        const ref = stream.session !== undefined ? stream.session[bunHTTP2Socket] : stream;
        ref[prop] = value;
        return true;
      }
    }
  },
};
const proxySocketHandler = {
  get(session, prop) {
    switch (prop) {
      case "setTimeout":
      case "ref":
      case "unref":
        return FunctionPrototypeBind.$call(session[prop], session);
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
        throw $ERR_HTTP2_NO_SOCKET_MANIPULATION();
      case "bytesWritten": {
        const socket = session[bunHTTP2Socket];
        if (!socket) {
          throw $ERR_HTTP2_SOCKET_UNBOUND();
        }
        return socketBytesWritten(socket);
      }
      default: {
        const socket = session[bunHTTP2Socket];
        if (!socket) {
          throw $ERR_HTTP2_SOCKET_UNBOUND();
        }
        const value = socket[prop];
        return typeof value === "function" ? FunctionPrototypeBind.$call(value, socket) : value;
      }
    }
  },
  getPrototypeOf(session) {
    const socket = session[bunHTTP2Socket];
    if (!socket) {
      throw $ERR_HTTP2_SOCKET_UNBOUND();
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
        throw $ERR_HTTP2_NO_SOCKET_MANIPULATION();
      default: {
        const socket = session[bunHTTP2Socket];
        if (!socket) {
          throw $ERR_HTTP2_SOCKET_UNBOUND();
        }
        socket[prop] = value;
        return true;
      }
    }
  },
};
const nameForErrorCode = [
  "NGHTTP2_NO_ERROR",
  "NGHTTP2_PROTOCOL_ERROR",
  "NGHTTP2_INTERNAL_ERROR",
  "NGHTTP2_FLOW_CONTROL_ERROR",
  "NGHTTP2_SETTINGS_TIMEOUT",
  "NGHTTP2_STREAM_CLOSED",
  "NGHTTP2_FRAME_SIZE_ERROR",
  "NGHTTP2_REFUSED_STREAM",
  "NGHTTP2_CANCEL",
  "NGHTTP2_COMPRESSION_ERROR",
  "NGHTTP2_CONNECT_ERROR",
  "NGHTTP2_ENHANCE_YOUR_CALM",
  "NGHTTP2_INADEQUATE_SECURITY",
  "NGHTTP2_HTTP_1_1_REQUIRED",
];
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
const {
  NGHTTP2_ERR_FRAME_SIZE_ERROR,
  NGHTTP2_SESSION_SERVER,
  NGHTTP2_SESSION_CLIENT,
  NGHTTP2_STREAM_STATE_IDLE,
  NGHTTP2_STREAM_STATE_OPEN,
  NGHTTP2_STREAM_STATE_RESERVED_LOCAL,
  NGHTTP2_STREAM_STATE_RESERVED_REMOTE,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE,
  NGHTTP2_STREAM_STATE_CLOSED,
  NGHTTP2_FLAG_NONE,
  NGHTTP2_FLAG_END_STREAM,
  NGHTTP2_FLAG_END_HEADERS,
  NGHTTP2_FLAG_ACK,
  NGHTTP2_FLAG_PADDED,
  NGHTTP2_FLAG_PRIORITY,
  DEFAULT_SETTINGS_HEADER_TABLE_SIZE,
  DEFAULT_SETTINGS_ENABLE_PUSH,
  DEFAULT_SETTINGS_MAX_CONCURRENT_STREAMS,
  DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE,
  DEFAULT_SETTINGS_MAX_FRAME_SIZE,
  DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE,
  DEFAULT_SETTINGS_ENABLE_CONNECT_PROTOCOL,
  MAX_MAX_FRAME_SIZE,
  MIN_MAX_FRAME_SIZE,
  MAX_INITIAL_WINDOW_SIZE,
  NGHTTP2_SETTINGS_HEADER_TABLE_SIZE,
  NGHTTP2_SETTINGS_ENABLE_PUSH,
  NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS,
  NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE,
  NGHTTP2_SETTINGS_MAX_FRAME_SIZE,
  NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE,
  NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL,
  PADDING_STRATEGY_NONE,
  PADDING_STRATEGY_ALIGNED,
  PADDING_STRATEGY_MAX,
  PADDING_STRATEGY_CALLBACK,
  NGHTTP2_NO_ERROR,
  NGHTTP2_PROTOCOL_ERROR,
  NGHTTP2_INTERNAL_ERROR,
  NGHTTP2_FLOW_CONTROL_ERROR,
  NGHTTP2_SETTINGS_TIMEOUT,
  NGHTTP2_STREAM_CLOSED,
  NGHTTP2_FRAME_SIZE_ERROR,
  NGHTTP2_REFUSED_STREAM,
  NGHTTP2_CANCEL,
  NGHTTP2_COMPRESSION_ERROR,
  NGHTTP2_CONNECT_ERROR,
  NGHTTP2_ENHANCE_YOUR_CALM,
  NGHTTP2_INADEQUATE_SECURITY,
  NGHTTP2_HTTP_1_1_REQUIRED,
  NGHTTP2_DEFAULT_WEIGHT,
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_AUTHORITY,
  HTTP2_HEADER_SCHEME,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_PROTOCOL,
  HTTP2_HEADER_ACCEPT_ENCODING,
  HTTP2_HEADER_ACCEPT_LANGUAGE,
  HTTP2_HEADER_ACCEPT_RANGES,
  HTTP2_HEADER_ACCEPT,
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS,
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS,
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS,
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN,
  HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS,
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS,
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD,
  HTTP2_HEADER_AGE,
  HTTP2_HEADER_AUTHORIZATION,
  HTTP2_HEADER_CACHE_CONTROL,
  HTTP2_HEADER_CONNECTION,
  HTTP2_HEADER_CONTENT_DISPOSITION,
  HTTP2_HEADER_CONTENT_ENCODING,
  HTTP2_HEADER_CONTENT_LENGTH,
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_COOKIE,
  HTTP2_HEADER_DATE,
  HTTP2_HEADER_ETAG,
  HTTP2_HEADER_FORWARDED,
  HTTP2_HEADER_HOST,
  HTTP2_HEADER_IF_MODIFIED_SINCE,
  HTTP2_HEADER_IF_NONE_MATCH,
  HTTP2_HEADER_IF_RANGE,
  HTTP2_HEADER_LAST_MODIFIED,
  HTTP2_HEADER_LINK,
  HTTP2_HEADER_LOCATION,
  HTTP2_HEADER_RANGE,
  HTTP2_HEADER_REFERER,
  HTTP2_HEADER_SERVER,
  HTTP2_HEADER_SET_COOKIE,
  HTTP2_HEADER_STRICT_TRANSPORT_SECURITY,
  HTTP2_HEADER_TRANSFER_ENCODING,
  HTTP2_HEADER_TE,
  HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS,
  HTTP2_HEADER_UPGRADE,
  HTTP2_HEADER_USER_AGENT,
  HTTP2_HEADER_VARY,
  HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS,
  HTTP2_HEADER_X_FRAME_OPTIONS,
  HTTP2_HEADER_KEEP_ALIVE,
  HTTP2_HEADER_PROXY_CONNECTION,
  HTTP2_HEADER_X_XSS_PROTECTION,
  HTTP2_HEADER_ALT_SVC,
  HTTP2_HEADER_CONTENT_SECURITY_POLICY,
  HTTP2_HEADER_EARLY_DATA,
  HTTP2_HEADER_EXPECT_CT,
  HTTP2_HEADER_ORIGIN,
  HTTP2_HEADER_PURPOSE,
  HTTP2_HEADER_TIMING_ALLOW_ORIGIN,
  HTTP2_HEADER_X_FORWARDED_FOR,
  HTTP2_HEADER_PRIORITY,
  HTTP2_HEADER_ACCEPT_CHARSET,
  HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE,
  HTTP2_HEADER_ALLOW,
  HTTP2_HEADER_CONTENT_LANGUAGE,
  HTTP2_HEADER_CONTENT_LOCATION,
  HTTP2_HEADER_CONTENT_MD5,
  HTTP2_HEADER_CONTENT_RANGE,
  HTTP2_HEADER_DNT,
  HTTP2_HEADER_EXPECT,
  HTTP2_HEADER_EXPIRES,
  HTTP2_HEADER_FROM,
  HTTP2_HEADER_IF_MATCH,
  HTTP2_HEADER_IF_UNMODIFIED_SINCE,
  HTTP2_HEADER_MAX_FORWARDS,
  HTTP2_HEADER_PREFER,
  HTTP2_HEADER_PROXY_AUTHENTICATE,
  HTTP2_HEADER_PROXY_AUTHORIZATION,
  HTTP2_HEADER_REFRESH,
  HTTP2_HEADER_RETRY_AFTER,
  HTTP2_HEADER_TRAILER,
  HTTP2_HEADER_TK,
  HTTP2_HEADER_VIA,
  HTTP2_HEADER_WARNING,
  HTTP2_HEADER_WWW_AUTHENTICATE,
  HTTP2_HEADER_HTTP2_SETTINGS,
  HTTP2_METHOD_ACL,
  HTTP2_METHOD_BASELINE_CONTROL,
  HTTP2_METHOD_BIND,
  HTTP2_METHOD_CHECKIN,
  HTTP2_METHOD_CHECKOUT,
  HTTP2_METHOD_CONNECT,
  HTTP2_METHOD_COPY,
  HTTP2_METHOD_DELETE,
  HTTP2_METHOD_GET,
  HTTP2_METHOD_HEAD,
  HTTP2_METHOD_LABEL,
  HTTP2_METHOD_LINK,
  HTTP2_METHOD_LOCK,
  HTTP2_METHOD_MERGE,
  HTTP2_METHOD_MKACTIVITY,
  HTTP2_METHOD_MKCALENDAR,
  HTTP2_METHOD_MKCOL,
  HTTP2_METHOD_MKREDIRECTREF,
  HTTP2_METHOD_MKWORKSPACE,
  HTTP2_METHOD_MOVE,
  HTTP2_METHOD_OPTIONS,
  HTTP2_METHOD_ORDERPATCH,
  HTTP2_METHOD_PATCH,
  HTTP2_METHOD_POST,
  HTTP2_METHOD_PRI,
  HTTP2_METHOD_PROPFIND,
  HTTP2_METHOD_PROPPATCH,
  HTTP2_METHOD_PUT,
  HTTP2_METHOD_REBIND,
  HTTP2_METHOD_REPORT,
  HTTP2_METHOD_SEARCH,
  HTTP2_METHOD_TRACE,
  HTTP2_METHOD_UNBIND,
  HTTP2_METHOD_UNCHECKOUT,
  HTTP2_METHOD_UNLINK,
  HTTP2_METHOD_UNLOCK,
  HTTP2_METHOD_UPDATE,
  HTTP2_METHOD_UPDATEREDIRECTREF,
  HTTP2_METHOD_VERSION_CONTROL,
  HTTP_STATUS_CONTINUE,
  HTTP_STATUS_SWITCHING_PROTOCOLS,
  HTTP_STATUS_PROCESSING,
  HTTP_STATUS_EARLY_HINTS,
  HTTP_STATUS_OK,
  HTTP_STATUS_CREATED,
  HTTP_STATUS_ACCEPTED,
  HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION,
  HTTP_STATUS_NO_CONTENT,
  HTTP_STATUS_RESET_CONTENT,
  HTTP_STATUS_PARTIAL_CONTENT,
  HTTP_STATUS_MULTI_STATUS,
  HTTP_STATUS_ALREADY_REPORTED,
  HTTP_STATUS_IM_USED,
  HTTP_STATUS_MULTIPLE_CHOICES,
  HTTP_STATUS_MOVED_PERMANENTLY,
  HTTP_STATUS_FOUND,
  HTTP_STATUS_SEE_OTHER,
  HTTP_STATUS_NOT_MODIFIED,
  HTTP_STATUS_USE_PROXY,
  HTTP_STATUS_TEMPORARY_REDIRECT,
  HTTP_STATUS_PERMANENT_REDIRECT,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_UNAUTHORIZED,
  HTTP_STATUS_PAYMENT_REQUIRED,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_METHOD_NOT_ALLOWED,
  HTTP_STATUS_NOT_ACCEPTABLE,
  HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_CONFLICT,
  HTTP_STATUS_GONE,
  HTTP_STATUS_LENGTH_REQUIRED,
  HTTP_STATUS_PRECONDITION_FAILED,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  HTTP_STATUS_URI_TOO_LONG,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
  HTTP_STATUS_RANGE_NOT_SATISFIABLE,
  HTTP_STATUS_EXPECTATION_FAILED,
  HTTP_STATUS_TEAPOT,
  HTTP_STATUS_MISDIRECTED_REQUEST,
  HTTP_STATUS_UNPROCESSABLE_ENTITY,
  HTTP_STATUS_LOCKED,
  HTTP_STATUS_FAILED_DEPENDENCY,
  HTTP_STATUS_TOO_EARLY,
  HTTP_STATUS_UPGRADE_REQUIRED,
  HTTP_STATUS_PRECONDITION_REQUIRED,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE,
  HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_IMPLEMENTED,
  HTTP_STATUS_BAD_GATEWAY,
  HTTP_STATUS_SERVICE_UNAVAILABLE,
  HTTP_STATUS_GATEWAY_TIMEOUT,
  HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED,
  HTTP_STATUS_VARIANT_ALSO_NEGOTIATES,
  HTTP_STATUS_INSUFFICIENT_STORAGE,
  HTTP_STATUS_LOOP_DETECTED,
  HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED,
  HTTP_STATUS_NOT_EXTENDED,
  HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED,
} = constants;

//TODO: desconstruct used constants.

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

function assertValidPseudoHeader(key) {
  if (!kValidPseudoHeaders.has(key)) {
    throw $ERR_HTTP2_INVALID_PSEUDOHEADER(key);
  }
}
hideFromStack(assertValidPseudoHeader);

// node's internal/http2/util sessionName() — used for debug output and exposed to the ported
// node test suite through the internals object below.
function sessionName(type: number) {
  switch (type) {
    case NGHTTP2_SESSION_SERVER:
      return "server";
    case NGHTTP2_SESSION_CLIENT:
      return "client";
    default:
      return "<invalid>";
  }
}

// node's internal/http2/util assertWithinRange(): settings-style range check that reports
// ERR_HTTP2_INVALID_SETTING_VALUE instead of ERR_OUT_OF_RANGE.
function assertWithinRange(name: string, value: number, min = 0, max = Infinity) {
  if (value !== undefined && (value < min || value > max || !Number.isFinite(value))) {
    throwSettingRangeError(name, value);
  }
}

// nghttp2_strerror() messages for the codes the runtime/test-suite surface; everything else uses
// nghttp2's default branch ("Unknown error code").
// https://github.com/nghttp2/nghttp2/blob/master/lib/nghttp2_helper.c (nghttp2_strerror)
const kNghttp2ErrorMessages = {
  0: "Success",
  [-501]: "Invalid argument",
  [-502]: "Out of buffer space",
  [-505]: "Protocol error",
  [-510]: "Stream was already closed or invalid",
  [-522]: "The length of the frame is invalid",
  [-523]: "Header compression/decompression error",
  [-524]: "Flow control error",
  [-901]: "Out of memory",
  [-903]: "Received bad client magic byte string",
  [-904]: "Flooding was detected in this HTTP/2 session, and it must be closed",
};

class NghttpError extends Error {
  code: string;
  errno: number;
  constructor(integerCode: number, customErrorCode?: string) {
    super(customErrorCode ? customErrorCode : kNghttp2ErrorMessages[integerCode] || "Unknown error code");
    this.code = customErrorCode || "ERR_HTTP2_ERROR";
    this.errno = integerCode;
  }

  toString() {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

const NoPayloadMethods = new Set([HTTP2_METHOD_DELETE, HTTP2_METHOD_GET, HTTP2_METHOD_HEAD]);

type Settings = {
  headerTableSize: number;
  enablePush: boolean;
  maxConcurrentStreams: number;
  initialWindowSize: number;
  maxFrameSize: number;
  maxHeaderListSize: number;
  maxHeaderSize: number;
};

class Http2Session extends EventEmitter {
  [bunHTTP2SessionTeardownFrame] = kNoSessionTeardown;
  [bunHTTP2Socket]: TLSSocket | Socket | null;
  [bunHTTP2OriginSet]: Set<string> | undefined = undefined;
  // Session-level frame (Node's Http2Session AsyncWrap): destroy()'s emits
  // run inside it so 'close' doesn't inherit the last stream's frame.
  [bunHTTP2AsyncContextFrame] = $getInternalField($asyncContext, 0);
  [kDeferWriteCallback] = setImmediate;
  [EventEmitter.captureRejectionSymbol](err, event, ...args) {
    switch (event) {
      case "stream": {
        const stream = args[0];
        stream.destroy(err);
        break;
      }
      default:
        this.destroy(err);
    }
  }
}

function streamErrorFromCode(code: number) {
  if (code === 0xe) {
    return $ERR_HTTP2_MAX_PENDING_SETTINGS_ACK();
  }
  return $ERR_HTTP2_STREAM_ERROR(nameForErrorCode[code] || code);
}
hideFromStack(streamErrorFromCode);
// Pending ping callbacks are invoked with the cancel error when their session goes away (node
// semantics) instead of being silently dropped. Like node's pingCallback wrapper, a cancelled
// ping reports only the error (no duration/payload arguments).
// Each ping() call is a tracked async resource (node's Http2Ping); the test
// asserts init/before/after/destroy fire for type 'HTTP2PING'.
const { AsyncResource } = require("node:async_hooks");
const kEmptyPingPayload = Buffer.alloc(8);
function makeHttp2Ping(callback) {
  const resource = new AsyncResource("HTTP2PING");
  return function done(err, duration, payload) {
    if (err) {
      resource.runInAsyncScope(callback, null, err);
    } else {
      resource.runInAsyncScope(callback, null, null, duration, payload);
    }
    resource.emitDestroy();
  };
}

function cancelPendingPings(callbacks): void {
  if (!callbacks) return;
  const err = $ERR_HTTP2_PING_CANCEL();
  for (let i = 0; i < callbacks.length; i++) {
    process.nextTick(callbacks[i][0], err);
  }
}

// ERR_HTTP2_STREAM_CANCEL is not in the native error-code registry (the registry is positional
// and shared across Rust/C++/the JS bundle, so additions need a coordinated regeneration);
// construct the node-shaped error directly. Mirrors node's ERR_HTTP2_STREAM_CANCEL(error).
function createPendingStreamCancelError(cause?: any) {
  let message = "The pending stream has been canceled";
  const cancelError = new Error(message);
  if (cause != null && typeof cause === "object") {
    cancelError.cause = cause;
    if (typeof cause.message === "string") {
      cancelError.message = `${message} (caused by: ${cause.message})`;
    }
  }
  cancelError.code = "ERR_HTTP2_STREAM_CANCEL";
  return cancelError;
}
// The native settings object for a server session: session options + the user's settings, with
// enablePush forced off only when the caller explicitly provided it (see the RFC 9113 §6.5.2 note
// at the construction site). Only explicitly-present settings are serialized by the native layer.
function serverNativeSettings(options) {
  const merged = { ...options, ...options?.settings };
  if (merged.enablePush !== undefined) merged.enablePush = false;
  return merged;
}

function sessionErrorFromCode(code: number) {
  if (code === 0xe) {
    return $ERR_HTTP2_MAX_PENDING_SETTINGS_ACK();
  }
  return $ERR_HTTP2_SESSION_ERROR(code);
}
hideFromStack(sessionErrorFromCode);
// Used for the legacy native error dispatches that still carry a positive HTTP/2 error code
// (e.g. MAX_PENDING_SETTINGS_ACK, ENHANCE_YOUR_CALM from the outbound paths): the message carries
// the NGHTTP2_* constant name. Violations detected by the inbound engine arrive as negative
// nghttp2 library codes and are surfaced as NghttpError (ERR_HTTP2_ERROR), exactly like node.
// GOAWAY-received errors stay numeric (sessionErrorFromCode) to match node's message exactly.
function sessionErrorFromCodeNamed(code: number) {
  if (code === 0xe) {
    return $ERR_HTTP2_MAX_PENDING_SETTINGS_ACK();
  }
  return $ERR_HTTP2_SESSION_ERROR(nameForErrorCode[code] || code);
}
hideFromStack(sessionErrorFromCodeNamed);

function assertSession(session) {
  if (!session) {
    throw $ERR_HTTP2_INVALID_SESSION();
  }
}
hideFromStack(assertSession);

// node validates with validateInt32(windowSize, 'windowSize', 0) whose range string is literally
// `>= ${min} && <= ${max}`:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/validators.js#L126
function validateWindowSize(windowSize) {
  if (typeof windowSize !== "number") {
    throw $ERR_INVALID_ARG_TYPE("windowSize", "number", windowSize);
  }
  if (!Number.isInteger(windowSize)) {
    throw $ERR_OUT_OF_RANGE("windowSize", "an integer", windowSize);
  }
  if (windowSize < 0 || windowSize > kMaxWindowSize) {
    throw $ERR_OUT_OF_RANGE("windowSize", `>= 0 && <= ${kMaxWindowSize}`, windowSize);
  }
}
hideFromStack(validateWindowSize);

function pushToStream(stream, data) {
  if (data && stream[bunHTTP2StreamStatus] & StreamState.Closed) {
    if (!stream._readableState.ended) {
      // closed, but not ended, so resume and push null to end the stream
      stream.resume();
      stream.push(null);
    }
    return;
  }

  // Node's onStreamRead (lib/internal/stream_base_commons.js): push() returning false
  // is the readable side's backpressure signal, and the reader must readStop()
  // synchronously - a consumer's read()/_read() from this very push must be the LAST
  // word on the window, not overwritten by a deferred stop. Without this half,
  // _read()'s readStart makes pause() unenforceable: one reopen lets the peer flood
  // past the buffer's high-water mark instead of stalling on the receive window.
  // setStreamReading(id, false) only records the paused bit natively, so calling it
  // from inside the dispatch that delivered `data` cannot re-enter the engine.
  if (!stream.push(data) && data !== null) {
    streamOnPause.$call(stream);
  }
}

enum StreamState {
  EndedCalled = 1 << 0, // 00001 = 1
  WantTrailer = 1 << 1, // 00010 = 2
  FinalCalled = 1 << 2, // 00100 = 4
  Closed = 1 << 3, // 01000 = 8
  StreamResponded = 1 << 4, // 10000 = 16
  WritableClosed = 1 << 5, // 100000 = 32
  // The native side fully closed and freed the stream (state 7 delivered): there is
  // nothing left to send on the wire for it.
  NativeClosed = 1 << 6, // 1000000 = 64
}
// native.writeStream() return-value flag (mirrors WRITE_FLUSHED_WITHOUT_CALLBACK in
// h2_frame_parser.rs): the chunk was handed to the socket without queueing and the engine did
// not invoke the write callback. The Writable callback is completed on a later turn instead, so
// write() never settles synchronously — node's Http2Stream writes also only complete after the
// session flushes to the socket, which is what makes write() return false past the
// highWaterMark and 'drain' fire afterwards. When the chunk was queued (flow-control or socket
// backpressure), the engine keeps the callback and invokes it once the queued frames flush.
const kWriteFlushedWithoutCallback = 0x10;
// Over a native socket the deferred callback can fire on nextTick (after write() returns) — the
// frame was already handed to the OS. Over a JS-side socket (duplexPair / generic Duplex) the
// frame is dispatched into the JS socket via onWrite, and the callback must wait a full
// event-loop turn so the JS-side delivery has run before 'drain' is observed
// (test-http2-backpressure). Chosen once per session.
function deferWriteCallbackForSocket(nativeSocket) {
  return nativeSocket ? process.nextTick : setImmediate;
}
function markWritableDone(stream: Http2Stream) {
  const _final = stream[bunHTTP2StreamFinal];
  if (typeof _final === "function") {
    stream[bunHTTP2StreamFinal] = null;
    _final();
    stream[bunHTTP2StreamStatus] |= StreamState.WritableClosed | StreamState.FinalCalled;
    return;
  }
  stream[bunHTTP2StreamStatus] |= StreamState.WritableClosed;
}
const kCloseChannelPublished = Symbol("closeChannelPublished");
function publishStreamCloseChannel(stream: Http2Stream) {
  // Diagnostics channels: the stream is transitioning to closed. Published exactly once per stream,
  // from whichever of markStreamClosed / _destroy runs first (with rstCode already established).
  if (stream[kCloseChannelPublished]) return;
  stream[kCloseChannelPublished] = true;
  if (stream instanceof ClientHttp2Stream) {
    if (onClientStreamCloseChannel.hasSubscribers) onClientStreamCloseChannel.publish({ stream });
  } else if (onServerStreamCloseChannel.hasSubscribers) {
    onServerStreamCloseChannel.publish({ stream });
  }
}
function markStreamClosed(stream: Http2Stream) {
  const status = stream[bunHTTP2StreamStatus];

  if ((status & StreamState.Closed) === 0) {
    stream[bunHTTP2StreamStatus] = status | StreamState.Closed;
    publishStreamCloseChannel(stream);

    markWritableDone(stream);
  }
}
function rstNextTick(id: number, rstCode: number) {
  const session = this as Http2Session;
  session[bunHTTP2Native]?.rstStream(id, rstCode);
}
// node streamOnPause/streamOnResume (lib/internal/http2/core.js): the readable's flow state
// drives the native receive window. While paused, the stream's window is not replenished; on
// resume the deferred WINDOW_UPDATE is sent. A pending stream (no id yet) has nothing on the
// wire to backpressure.
function streamOnPause(this: Http2Stream) {
  const session = this[bunHTTP2Session];
  const id = this.id;
  if (session && id) session[bunHTTP2Native]?.setStreamReading(id, false);
}
function streamOnResume(this: Http2Stream) {
  const session = this[bunHTTP2Session];
  const id = this.id;
  if (session && id) session[bunHTTP2Native]?.setStreamReading(id, true);
}
// A close() on a stream that has not been submitted yet (no id): the RST_STREAM has to follow the
// HEADERS frame, which is sent when the queued request becomes ready (node's finishCloseStream).
function sendRstOnReady(this: Http2Stream, session: Http2Session, code: number) {
  setImmediate(rstNextTick.bind(session, this.id, code));
}
function uncorkNT(stream: Http2Stream) {
  stream.uncork();
}
// Per-request AbortSignal handler: node destroys the stream with an AbortError when the signal
// fires (lib/internal/http2/core.js request()).
function abortRequestStream(this: Http2Stream, signal: AbortSignal) {
  this.destroy($makeAbortError(undefined, { cause: signal.reason }));
}
// Shared tail of ClientHttp2Session.request(): node closes the writable side when endStream is
// set (the END_STREAM flag itself rides on the HEADERS frame) and attaches exactly one 'abort'
// listener per request, detached when the stream closes.
function setupRequestEndAndSignal(req: Http2Stream, options: any, signal: AbortSignal | undefined) {
  if (options?.endStream) req.end();
  if (signal) {
    addAbortListener ??= require("internal/abort_listener").addAbortListener;
    const disposable = addAbortListener(signal, abortRequestStream.bind(req, signal));
    req.once("close", disposable[Symbol.dispose]);
  }
}
// node destroys every open stream synchronously from inside session.destroy(): a write() issued
// right after destroy() must already observe an ended + destroyed stream (write-after-end without
// an 'error' event), and stream teardown must not wait a tick.
function destroyStreamForSessionDestroy(error: Error | undefined, rstCode: number, stream: Http2Stream) {
  if (stream.destroyed) return;
  if (rstCode && !stream.rstCode) stream.rstCode = rstCode;
  // A clean session teardown can reach here while a stream's already-received request data is
  // still being drained by its consumer: the native side is done with the stream (state 7,
  // which is what allowed the session to start destroying), but the JS side is not. Destroying
  // now discards that data and emits 'close' without 'end' (a piped request body never
  // finishes). Node's session waits for the JS stream, so finish delivering and destroy on
  // 'end'. Only for natively-closed streams: a still-open one must keep node's contract that
  // session.destroy() destroys it synchronously (and the engine error sweep follows for it).
  if (
    error === undefined &&
    (stream[bunHTTP2StreamStatus] & StreamState.NativeClosed) !== 0 &&
    stream.readable &&
    stream.readableFlowing !== null
  ) {
    stream.push(null);
    stream.once("end", destroySelfOnEnd);
    return;
  }
  // Only surface the session error on streams that are listening for it (the
  // same guard emitStreamErrorNT applies): a still-open stream with no 'error'
  // listener would otherwise turn session.destroy(code) into an uncaught
  // exception (e.g. grpc-js forceShutdown destroying sessions with
  // NGHTTP2_CANCEL while unread UNIMPLEMENTED streams are still around).
  stream.destroy(error !== undefined && stream.listenerCount("error") > 0 ? error : undefined);
}
class Http2Stream extends Duplex {
  #id: number;
  [bunHTTP2Session]: ClientHttp2Session | ServerHttp2Session | null = null;
  [bunHTTP2StreamFinal]: VoidFunction | null = null;
  [bunHTTP2StreamStatus]: number = 0;
  // Async-context frame captured at construction so native-driven callbacks
  // (response/data/end/…) on client streams observe the AsyncLocalStorage
  // context that request() ran in, matching Node's Http2Stream AsyncWrap.
  // Read only by withStreamFrame; user-initiated emit() is untouched. The raw
  // frame is snapshotted directly so session.request() does not flip on
  // async-context tracking when no AsyncLocalStorage is in use.
  [bunHTTP2AsyncContextFrame] = $getInternalField($asyncContext, 0);

  rstCode: number | undefined = undefined;
  [bunHTTP2Headers]: any;
  [kInfoHeaders]: any;
  #sentTrailers: any;
  [kSendingTrailers]: boolean = false;
  [kAborted]: boolean = false;
  [kHeadRequest]: boolean = false;
  constructor(streamId, session, headers) {
    super({
      decodeStrings: false,
      autoDestroy: false,
    });
    this.#id = streamId;
    this[bunHTTP2Session] = session;
    this[bunHTTP2Headers] = headers;
    // node ties the stream's receive window to JS-side consumption (readStart/readStop on the
    // native handle): while the readable is paused the peer is not granted more window, so it
    // backpressures instead of the session buffering the whole body.
    this.on("pause", streamOnPause);
    this.on("resume", streamOnResume);
  }

  get scheme() {
    const headers = this[bunHTTP2Headers];
    if (headers) return headers[":scheme"] || "https";
    return "https";
  }

  get id() {
    return this.#id;
  }

  get pending() {
    return !this.#id;
  }

  // A request queued behind the peer's SETTINGS_MAX_CONCURRENT_STREAMS limit is created without
  // an id; the id is assigned right before its HEADERS frame is actually submitted.
  [kSetStreamId](id: number) {
    this.#id = id;
  }

  // Mirrors node's Http2Stream[kInspect] (lib/internal/http2/core.js).
  [kInspect](depth, opts) {
    if (typeof depth === "number" && depth < 0) return this;

    const obj = {
      id: this.#id || "<pending>",
      closed: this.closed,
      destroyed: this.destroyed,
      state: this.state,
      readableState: this._readableState,
      writableState: this._writableState,
    };
    util ??= require("node:util");
    return `Http2Stream ${util.inspect(obj, opts)}`;
  }

  get bufferSize() {
    // node: kState.writeQueueSize + writableLength
    // (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js Http2Stream#bufferSize).
    // There is no separate native write-queue counter here: bytes that have not reached the
    // native session yet (a pending stream, or chunks buffered behind an in-flight write) are all
    // accounted for by writableLength.
    return this.writableLength;
  }

  get sentHeaders() {
    return this[bunHTTP2Headers];
  }

  get sentInfoHeaders() {
    return this[kInfoHeaders] || [];
  }

  get sentTrailers() {
    return this.#sentTrailers;
  }
  get headRequest() {
    return !!this[kHeadRequest];
  }

  sendTrailers(headers) {
    const session = this[bunHTTP2Session];

    if (this.destroyed || this.closed) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }

    if (this.#sentTrailers) {
      throw $ERR_HTTP2_TRAILERS_ALREADY_SENT();
    }
    assertSession(session);

    if ((this[bunHTTP2StreamStatus] & StreamState.WantTrailer) === 0) {
      throw $ERR_HTTP2_TRAILERS_NOT_READY();
    }

    if (headers == undefined) {
      headers = {};
    } else if (!$isObject(headers) || $isArray(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }
    const sensitives = headers[sensitiveHeaders];
    if (sensitives !== undefined && !$isArray(sensitives)) {
      throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
    }
    // Note: the sensitiveHeaders symbol stays on the object — the native header walk skips
    // symbol keys, and deleting it here would flip the object into dictionary mode,
    // pessimizing every later property access on it.
    const sensitiveNames = buildSensitiveNames(headers, sensitives);
    // node keeps the never-index list visible on sentTrailers (symbol keys are not iterated by
    // the wire-encoding path, so re-attaching is safe).
    if (sensitives !== undefined) headers[sensitiveHeaders] = sensitives;
    // RFC 9113 §8.1 doesn't explicitly forbid an empty trailer HEADERS frame,
    // but strict peer implementations (nghttp2, used by curl and Node) reject
    // a zero-length HPACK block as a callback failure. When the user passes an
    // empty trailer object (which the compat Http2ServerResponse does
    // unconditionally from onStreamTrailersReady), emit an empty DATA frame
    // with END_STREAM instead — this matches Node's wire output.
    // Mark before the native call so a re-entrant sendTrailers() from a header-value
    // coercion hits ERR_HTTP2_TRAILERS_ALREADY_SENT, but clear it if validation throws
    // (no frame is written then) so a corrected retry succeeds like node.
    this.#sentTrailers = headers;
    this[kSendingTrailers] = true;
    try {
      if (ObjectKeys(headers).length === 0) {
        session[bunHTTP2Native]?.noTrailers(this.#id);
      } else {
        session[bunHTTP2Native]?.sendTrailers(this.#id, headers, sensitiveNames);
      }
    } catch (error) {
      this.#sentTrailers = undefined;
      throw error;
    } finally {
      this[kSendingTrailers] = false;
    }
  }

  setTimeout(timeout, callback) {
    const session = this[bunHTTP2Session];
    if (!session) return;
    session.setTimeout(timeout, callback);
  }

  get closed() {
    return (this[bunHTTP2StreamStatus] & StreamState.Closed) !== 0;
  }

  get destroyed() {
    return (
      this[bunHTTP2Session] === null ||
      (this._readableState !== undefined &&
        this._writableState !== undefined &&
        this._readableState.destroyed === true &&
        this._writableState.destroyed === true)
    );
  }

  set destroyed(value) {
    // Backwards-compat assignment (node's Duplex exposes the same setter); the http2 compat
    // socket proxy forwards `socket.destroyed = x` here.
    if (this._readableState !== undefined && this._writableState !== undefined) {
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  }

  get state() {
    const session = this[bunHTTP2Session];
    if (session && !session.destroyed && typeof this.#id === "number") {
      return session[bunHTTP2Native]?.getStreamState(this.#id) ?? {};
    }
    // node reports an empty object while the stream is still pending (no id yet) and once the
    // stream's session has been destroyed.
    return {};
  }

  priority(_options) {
    // RFC 9113 deprecated stream priority signalling; node's Http2Stream#priority() is a no-op
    // that emits DEP0194 once.
    if (!priorityDeprecationWarned) {
      priorityDeprecationWarned = true;
      process.emitWarning(
        "http2Stream.priority is longer supported after priority signalling was deprecated in RFC 9113",
        "DeprecationWarning",
        "DEP0194",
      );
    }
    if (this.destroyed || this.session === undefined) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }
    return true;
  }

  get endAfterHeaders() {
    const session = this[bunHTTP2Session];
    if (session) {
      return session[bunHTTP2Native]?.getEndAfterHeaders(this.#id) || false;
    }
    return false;
  }

  get aborted() {
    return this[kAborted] || false;
  }

  get session() {
    // node detaches the session reference once the session has been destroyed.
    const session = this[bunHTTP2Session];
    if (session == null || session.destroyed) return undefined;
    return session;
  }

  get pushAllowed() {
    // node: pushAllowed is only meaningful on server streams (session.type === 0) - it reflects
    // whether the connected client advertised SETTINGS_ENABLE_PUSH=1. A client stream can never
    // push, regardless of the server-settings default.
    const session = this[bunHTTP2Session];
    return (
      session != null && session.type === 0 && !!session.remoteSettings?.enablePush && !this.destroyed && !this.closed
    );
  }
  close(code, callback) {
    if ((this[bunHTTP2StreamStatus] & StreamState.Closed) === 0) {
      const session = this[bunHTTP2Session];
      assertSession(session);
      if (code === undefined) code = 0;
      validateInteger(code, "code");
      if (code < 0 || code > kMaxInt) {
        // node validates with validateInteger(code, 'code', 0, kMaxInt) whose range string is
        // literally `>= ${min} && <= ${max}`:
        // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/validators.js#L102
        throw $ERR_OUT_OF_RANGE("code", `>= 0 && <= ${kMaxInt}`, code);
      }

      if (typeof callback !== "undefined") {
        validateFunction(callback, "callback");
        this.once("close", callback);
      }
      this.push(null);
      const { ending } = this._writableState;
      if (!ending) {
        // If the writable side of the Http2Stream is still open, emit the
        // 'aborted' event and set the aborted flag.
        if (!this.aborted) {
          this[kAborted] = true;
          this.emit("aborted");
        }
        this.end();
      }
      this.rstCode = code;
      markStreamClosed(this);
      if (this.pending) {
        // No id yet (the HEADERS frame is still queued behind connect/concurrency limits): the
        // RST_STREAM has to be sent after the HEADERS frame, once the id is assigned.
        this.once("ready", sendRstOnReady.bind(this, session, code));
      } else if (this.writableFinished || code) {
        setImmediate(rstNextTick.bind(session, this.#id, code));
      } else {
        this.once("finish", rstNextTick.bind(session, this.#id, code));
      }
      // node destroys the stream once both halves have finished; without this a stream closed
      // while idle never emits 'close'.
      if (this.writableFinished) {
        scheduleDestroyIfNotDestroyed(this);
      } else {
        this.once("finish", scheduleDestroyIfNotDestroyed.bind(null, this));
      }
    }
  }
  _destroy(err, callback) {
    // Cleared first: everything below can reach user code ('aborted', end(),
    // push(null)) and a throwing listener would otherwise skip the clear and
    // leave a retained stream pinning the store.
    this[bunHTTP2AsyncContextFrame] = undefined;
    const { ending } = this._writableState;
    this.push(null);
    // A pushed stream's request was synthesized by the server, so its local (writable) half is
    // closed by definition — closing it is not an abort and nothing must be sent on the wire.
    if (!ending && !this[kPush]) {
      // If the writable side of the Http2Stream is still open, emit the
      // 'aborted' event and set the aborted flag.
      if (!this.aborted) {
        this[kAborted] = true;
        this.emit("aborted");
      }
      // at this state destroyed will be true but we need to close the writable side
      this._writableState.destroyed = false;
      this.end();
      // we now restore the destroyed flag
      this._writableState.destroyed = true;
    }

    const session = this[bunHTTP2Session];
    assertSession(session);

    let rstCode = this.rstCode;
    if (!rstCode) {
      if (err != null) {
        if (err.code === "ABORT_ERR") {
          // Enables using AbortController to cancel requests with RST code 8.
          rstCode = NGHTTP2_CANCEL;
        } else {
          rstCode = NGHTTP2_INTERNAL_ERROR;
        }
      } else {
        rstCode = this.rstCode = 0;
      }
    }
    this.rstCode = rstCode;
    // node closes the stream from inside _destroy, so the close-channel publish observes
    // closed === true and destroyed === true with the final rstCode. The non-error close path
    // (streamEnd state=7) calls markStreamClosed BEFORE destroy(), where the channel observes
    // destroyed === false instead.
    markStreamClosed(this);
    // RST code 8 not emitted as an error as its used by clients to signify
    // abort and is already covered by aborted event, also allows more
    // seamless compatibility with http1. When the session is being torn down with an error
    // (closeSession in node passes the session error to every stream), surface that error
    // instead of a generic stream error so the same error reaches both client.on('error')
    // and req.on('error') regardless of which dispatch path reached _destroy first.
    if (err == null && rstCode !== NGHTTP2_NO_ERROR && rstCode !== NGHTTP2_CANCEL) {
      err = session?.[kSessionDestroyError] ?? $ERR_HTTP2_STREAM_ERROR(nameForErrorCode[rstCode] || rstCode);
    }

    this[bunHTTP2Session] = null;
    // This notifies the session that this stream has been destroyed and
    // gives the session the opportunity to clean itself up. The session
    // will destroy if it has been closed and there are no other open or
    // pending streams. Delay with setImmediate so we don't do it on the
    // nghttp2 stack.
    if (
      session &&
      typeof this.#id === "number" &&
      !this[kNeverAnnounced] &&
      // A cleanly closed stream the native side already freed has nothing to send:
      // the deferred rstStream would be a guaranteed no-op host call per request.
      (rstCode !== 0 || (this[bunHTTP2StreamStatus] & StreamState.NativeClosed) === 0)
    ) {
      setImmediate(rstNextTick.bind(session, this.#id, rstCode));
    }

    // Diagnostics channels: published after the stream is closed and destroyed, with the same error
    // instance the stream is destroyed with (node publishes from this same point in its _destroy).
    if (err != null) {
      if (this instanceof ClientHttp2Stream) {
        if (onClientStreamErrorChannel.hasSubscribers) onClientStreamErrorChannel.publish({ stream: this, error: err });
      } else if (onServerStreamErrorChannel.hasSubscribers) {
        onServerStreamErrorChannel.publish({ stream: this, error: err });
      }
    }
    callback(err);
  }

  _final(callback) {
    if (this.pending) {
      // Not submitted yet (queued behind the peer's concurrency limit): wait for the id.
      this.once("ready", this._final.bind(this, callback));
      return;
    }
    const status = this[bunHTTP2StreamStatus];

    if (onClientStreamBodySentChannel.hasSubscribers && this instanceof ClientHttp2Stream) {
      onClientStreamBodySentChannel.publish({ stream: this });
    }
    const session = this[bunHTTP2Session];
    if (session) {
      const native = session[bunHTTP2Native];
      if (native) {
        if (this instanceof ServerHttp2Stream && !this.headersSent && (this.id & 1) === 0) {
          // A locally-pushed (even-id) stream ended before respond() (HEAD/endStream pushes): an
          // empty DATA frame would precede the response HEADERS on the wire. respond() forces
          // endStream for these streams, so END_STREAM rides on the HEADERS frame and the
          // onStreamEnd(5) dispatch completes this callback through markWritableDone.
          this[bunHTTP2StreamFinal] = callback;
          return;
        }
        this[bunHTTP2StreamStatus] |= StreamState.FinalCalled;
        // When waitForTrailers is active, writing an empty DATA frame with
        // close=true emits a bare empty DATA frame (flags=0) to the wire
        // before the trailer/noTrailers path runs, which then emits ANOTHER
        // empty DATA (with END_STREAM). Two consecutive empty DATA frames
        // confuse strict peers (nghttp2 callback failure). Skip the empty
        // writeStream and drive the wantTrailers path directly — the
        // eventual `sendTrailers({})` → `noTrailers` call terminates the
        // stream with a single empty DATA END_STREAM frame, matching Node.
        if (this[bunHTTP2WaitForTrailers]) {
          this[bunHTTP2WaitForTrailers] = false;
          if ((this[bunHTTP2StreamStatus] & StreamState.WantTrailer) === 0) {
            this[bunHTTP2StreamStatus] |= StreamState.WantTrailer;
            // The native call below can settle the stream to CLOSED synchronously (the peer
            // already half-closed) and the streamEnd(7) handler runs markStreamClosed →
            // markWritableDone before control returns here: stash the callback there so the
            // writable finishes ('finish' before 'close') instead of being torn down mid-final.
            this[bunHTTP2StreamFinal] = callback;
            if ((this[bunHTTP2StreamStatus] & StreamState.Closed) !== 0 || this.listenerCount("wantTrailers") === 0) {
              // No 'wantTrailers' listener — or the stream was close()d while the last write
              // was still in flight, in which case node never asks for trailers (the compat
              // onStreamTrailersReady would throw ERR_HTTP2_INVALID_STREAM on a closed
              // stream): end the writable with the empty END_STREAM DATA frame directly.
              native.noTrailers(this.#id);
              // Mark trailers as "sent" so a later stream.sendTrailers()
              // call hits the ERR_HTTP2_TRAILERS_ALREADY_SENT guard instead
              // of invoking native noTrailers() a second time on an
              // already-half-closed stream. The emit("wantTrailers") path
              // below reaches the same result via sendTrailers({}) which
              // assigns #sentTrailers itself.
              this.#sentTrailers = {};
            } else {
              this.emit("wantTrailers");
            }
            // Hand the END_STREAM (or trailer) frame to the socket now: with deferred write
            // completion, _final can run on the program's last live turn and a frame left in
            // the cork for the auto-flusher would strand a generic-streams (duplexPair) peer
            // waiting for 'end'.
            native.flush();
            if (this[bunHTTP2StreamFinal] !== callback) {
              // markWritableDone already consumed and invoked the callback during the
              // synchronous streamEnd dispatch above.
              return;
            }
            this[bunHTTP2StreamFinal] = null;
          }
          callback();
          return;
        }
        const settled = native.writeStream(this.#id, "", "ascii", true, callback);
        // Same as above: don't leave the END_STREAM frame in the cork on what may be the
        // program's last live turn.
        native.flush();
        if (settled === 5) {
          // HALF_CLOSED_LOCAL settled synchronously; the dispatch was suppressed.
          markWritableDone(this);
          // A server-initiated push (even id) has no client→server half, so HALF_CLOSED_LOCAL is
          // its CLOSED state — mark it closed here so the diagnostics close-channel observes
          // destroyed === false and rstCode === NGHTTP2_NO_ERROR, like node's nghttp2
          // onStreamClose path.
          if ((this.#id & 1) === 0 && this[bunHTTP2Session]?.type === constants.NGHTTP2_SESSION_SERVER) {
            if (!this.rstCode) this.rstCode = 0;
            markStreamClosed(this);
          }
        }
        return;
      }
    }
    if ((status & StreamState.WritableClosed) !== 0 || (status & StreamState.Closed) !== 0) {
      callback();
      this[bunHTTP2StreamStatus] |= StreamState.FinalCalled;
    } else {
      this[bunHTTP2StreamFinal] = callback;
    }
  }

  _read(_size) {
    // Node's Http2Stream._read (lib/internal/http2/core.js): every read re-opens the
    // stream's receive window (readStart). A pull-mode read() after pause() never
    // emits 'resume', so this is the only path that reopens the window for it. This
    // is only correct together with pushToStream's readStop-on-full-buffer above:
    // Node's Readable calls _read even while paused (maybeReadMore), so an unbounded
    // reopen here would otherwise defeat pause() entirely.
    if (this.destroyed) {
      this.push(null);
      return;
    }
    if (!this.pending) {
      streamOnResume.$call(this);
    } else {
      this.once("ready", streamOnResume);
    }
  }

  end(chunk, encoding, callback) {
    const status = this[bunHTTP2StreamStatus];
    if (typeof callback === "undefined") {
      if (typeof chunk === "function") {
        callback = chunk;
        chunk = undefined;
      } else if (typeof encoding === "function") {
        callback = encoding;
        encoding = undefined;
      }
    }

    if ((status & StreamState.EndedCalled) !== 0) {
      typeof callback == "function" && callback();
      // Writable#end always returns the stream (request(...).end() chains rely on it).
      return this;
    }
    this[bunHTTP2StreamStatus] = status | StreamState.EndedCalled;
    // Don't create an empty buffer for end() without data - let the Duplex stream
    // handle it naturally (just calls _final without _write for empty data).
    // Creating an empty buffer here causes an extra empty DATA frame to be sent.
    return super.end(chunk, encoding, callback);
  }

  _writev(data, callback) {
    if (this.pending) {
      // Not submitted yet (queued behind the peer's concurrency limit): wait for the id.
      this.once("ready", this._writev.bind(this, data, callback));
      return;
    }
    const session = this[bunHTTP2Session];
    if (session) {
      const native = session[bunHTTP2Native];
      if (native) {
        const allBuffers = data.allBuffers;
        let chunks;
        if (allBuffers) {
          // Same in-place unwrap node's writevGeneric does: the published `data` ends up as a plain
          // array of Buffers when every chunk is a Buffer.
          chunks = data;
          for (let i = 0; i < data.length; i++) {
            data[i] = data[i].chunk;
          }
        } else {
          // Mixed chunks: keep the published `data` as the original { chunk, encoding } entries.
          chunks = new Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const { chunk, encoding } = data[i];
            if (typeof chunk === "string") {
              chunks[i] = Buffer.from(chunk, encoding);
            } else {
              chunks[i] = chunk;
            }
          }
        }
        const chunk = Buffer.concat(chunks || []);
        if (session[kTimeout]) session[kTimeout].refresh();
        const status = native.writeStream(this.#id, chunk, undefined, false, callback, true);
        if (status & kWriteFlushedWithoutCallback) session[kDeferWriteCallback](callback);
        if (onClientStreamBodyChunkSentChannel.hasSubscribers && this instanceof ClientHttp2Stream) {
          onClientStreamBodyChunkSentChannel.publish({ stream: this, writev: true, data, encoding: "" });
        }
        return;
      }
    }
    if (typeof callback == "function") {
      callback();
    }
  }
  _write(chunk, encoding, callback) {
    if (this.pending) {
      // Not submitted yet (queued behind the peer's concurrency limit): wait for the id.
      this.once("ready", this._write.bind(this, chunk, encoding, callback));
      return;
    }
    const session = this[bunHTTP2Session];
    if (session) {
      const native = session[bunHTTP2Native];
      if (native) {
        let wireChunk = chunk;
        let wireEncoding = encoding;
        if (typeof chunk === "string" && (encoding === "utf-16le" || encoding === "utf16le" || encoding === "ucs-2")) {
          // The native write path does not know the utf-16 aliases; encode here. Diagnostics
          // subscribers still see the user-provided string and encoding.
          wireChunk = Buffer.from(chunk, encoding);
          wireEncoding = undefined;
        }
        if (session[kTimeout]) session[kTimeout].refresh();
        const status = native.writeStream(this.#id, wireChunk, wireEncoding, false, callback, true);
        if (status & kWriteFlushedWithoutCallback) session[kDeferWriteCallback](callback);
        if (onClientStreamBodyChunkSentChannel.hasSubscribers && this instanceof ClientHttp2Stream) {
          onClientStreamBodyChunkSentChannel.publish({ stream: this, writev: false, data: chunk, encoding });
        }
        return;
      }
    }
    if (typeof callback == "function") {
      callback();
    }
  }

  [EventEmitter.captureRejectionSymbol](err, event, ...args) {
    switch (event) {
      case "stream": {
        const stream = args[0];
        stream.destroy(err);
        break;
      }
      default:
        this.destroy(err);
    }
  }
}
class ClientHttp2Stream extends Http2Stream {}

// Wrap a native→JS #Handlers callback so its body runs inside the target
// stream's captured async-context frame — the JS-side equivalent of Node's
// AsyncWrap MakeCallback re-entering the resource scope. Applied only at the
// native seam, not to public emit(), so user-driven emit()/destroy() observe
// the caller's ALS context (matching Node).
function withStreamFrame(handler) {
  return function (self, stream, a, b, c) {
    if (typeof stream !== "object" || stream === null) return handler(self, stream, a, b, c);
    // A session mid-destroy() fans onStreamError out via emitErrorToAllStreams
    // under the destroy() caller's captured frame (Node's teardown context),
    // scoped to that session so a coincident dispatch elsewhere is unaffected.
    const teardownFrame = self != null ? self[bunHTTP2SessionTeardownFrame] : kNoSessionTeardown;
    const frame = teardownFrame !== kNoSessionTeardown ? teardownFrame : stream[bunHTTP2AsyncContextFrame];
    return runInFrame(frame, handler, undefined, self, stream, a, b, c);
  };
}
function tryClose(fd) {
  try {
    fs.close(fd);
  } catch {}
}

// Shared by respondWithFile (the stream owns the descriptor it opened: every terminal path closes
// it exactly once) and respondWithFD (the caller owns the descriptor: nothing here may close it,
// matching node's doSendFD).
function doSendFileFD(options, fd, headers, err, stat) {
  const onError = options.onError;
  const ownsFd = this[kOwnsFd] === true;
  if (err) {
    if (ownsFd && err.code !== "EBADF") {
      tryClose(fd);
    }

    if (onError) onError(err);
    else {
      this.respond(headers, options);
      this.destroy(streamErrorFromCode(NGHTTP2_INTERNAL_ERROR));
    }
    return;
  }

  if (!stat.isFile()) {
    const isDirectory = stat.isDirectory();
    if (
      options.offset !== undefined ||
      options.offset > 0 ||
      options.length !== undefined ||
      options.length >= 0 ||
      isDirectory
    ) {
      const err = isDirectory ? $ERR_HTTP2_SEND_FILE() : $ERR_HTTP2_SEND_FILE_NOSEEK();
      if (ownsFd) tryClose(fd);
      if (onError) onError(err);
      else {
        this.respond(headers, options);
        this.destroy(err);
      }
      return;
    }

    options.offset = 0;
    options.length = -1;
  }

  if (this.destroyed || this.closed) {
    if (ownsFd) tryClose(fd);
    this.destroy($ERR_HTTP2_INVALID_STREAM());
    return;
  }

  const statOptions = {
    offset: options.offset !== undefined ? options.offset : 0,
    length: options.length !== undefined ? options.length : -1,
  };
  if (statOptions.offset <= 0) {
    statOptions.offset = 0;
  }
  if (statOptions.length <= 0) {
    if (stat.isFile()) {
      statOptions.length = stat.size;
    } else {
      statOptions.length = undefined;
    }
  }
  // options.statCheck is a user-provided function that can be used to
  // verify stat values, override or set headers, or even cancel the
  // response operation. If statCheck explicitly returns false, the
  // response is canceled. The user code may also send a separate type
  // of response so check again for the HEADERS_SENT flag
  if (
    (typeof options.statCheck === "function" && options.statCheck.$call(this, stat, headers, options) === false) ||
    this.headersSent
  ) {
    if (this[kOwnsFd] === true) tryClose(fd);
    return;
  }

  if (stat.isFile()) {
    statOptions.length =
      statOptions.length < 0
        ? stat.size - +statOptions.offset
        : Math.min(stat.size - +statOptions.offset, statOptions.length);
    // remove content-length header
    for (let i in headers) {
      if (i?.toLowerCase() === HTTP2_HEADER_CONTENT_LENGTH) {
        delete headers[i];
      }
    }
    headers[HTTP2_HEADER_CONTENT_LENGTH] = statOptions.length;
  }
  try {
    this.respond(headers, options);
  } catch (err) {
    // respond() rejected the headers (e.g. a request pseudo-header in the response): the fd opened
    // for the file never reaches a read stream, so close it here before the stream is destroyed.
    if (this[kOwnsFd] === true) tryClose(fd);
    if (typeof onError === "function") {
      onError(err);
    } else {
      this.destroy(err);
    }
    return;
  }

  // The file is piped to the native stream directly below; its completion runs the regular
  // _final (END_STREAM / wantTrailers) logic returned here.
  const finishNativeStream = closeWritableForFileResponse(this);

  const stream = this;
  const fileStream = fs.createReadStream(null, {
    fd: fd,
    // An fd opened by respondWithFile is closed by its read stream once the transfer ends or
    // fails; an fd handed to respondWithFD stays the caller's to close (node semantics).
    autoClose: this[kOwnsFd] === true,
    start: statOptions.offset ? statOptions.offset : undefined,
    end: typeof statOptions.length === "number" ? statOptions.length + (statOptions.offset || 0) - 1 : undefined,
    emitClose: false,
  });
  const sink = new Stream.Writable({
    write(chunk, _encoding, cb) {
      const native = stream[bunHTTP2Session]?.[bunHTTP2Native];
      if (!native || stream.destroyed || stream.closed) {
        cb();
        return;
      }
      const status = native.writeStream(stream.id, chunk, undefined, false, cb, true);
      if (status & kWriteFlushedWithoutCallback) process.nextTick(cb);
    },
    final(cb) {
      if (stream.destroyed || stream.closed) {
        cb();
        return;
      }
      finishNativeStream(cb);
    },
  });
  // A read error mid-transfer tears the stream down like node's onPipedFileHandleRead; if the
  // stream itself goes away (peer reset, session destroy), stop reading the file. Like node's
  // onFileUnpipe, only an fd the stream opened itself (respondWithFile) is closed here; an fd
  // handed to respondWithFD stays the caller's to close.
  fileStream.on("error", onFileStreamError.bind(this));
  this.once("close", () => {
    fileStream.unpipe(sink);
    if (ownsFd) fileStream.destroy();
    else fileStream.pause();
  });
  fileStream.pipe(sink);
}
function onFileStreamError(this: Http2Stream) {
  if (!this.destroyed && !this.closed) this.close(NGHTTP2_INTERNAL_ERROR);
}
const kFileResponseFinal = Symbol("fileResponseFinal");
// node processRespondWithFD: a file response closes the user-facing writable side
// (`self._final = null; self.end()`), so a stream.end() issued by the user afterwards cannot cut
// the transfer short. Returns the original _final, which the file sink runs once the whole file
// has been handed to the native stream. Idempotent: respondWithFD() (no statCheck) neutralizes
// synchronously, like node, while doSendFileFD — shared with respondWithFile — runs after fstat.
function closeWritableForFileResponse(stream: Http2Stream) {
  let final = stream[kFileResponseFinal];
  if (final === undefined) {
    final = stream._final.bind(stream);
    stream[kFileResponseFinal] = final;
    stream._final = null;
    stream.end();
  }
  return final;
}
function afterOpen(options, headers, err, fd) {
  const onError = options.onError;
  if (err) {
    tryClose(fd);
    if (onError) onError(err);
    else this.destroy(err);
    return;
  }
  if (this.destroyed || this.closed) {
    tryClose(fd);
    return;
  }

  fs.fstat(fd, doSendFileFD.bind(this, options, fd, headers));
}

// Node's Http2Stream[kMaybeDestroy] server branch (lib/internal/http2/core.js): once the
// response has finished, a server stream with no pending trailers whose request body was
// never consumed (no read()/'data'/pipe - readableDidRead + readableFlowing) is closed
// with RST_STREAM NO_ERROR. Without it a rejected upload deadlocks: the request body
// stalls once the receive window fills (nothing reads, so backpressure never reopens it)
// and the stream never reaches the fully-closed state, so the peer is never released.
// setImmediate matches node (it lets push streams reach the peer before the close).
//
// Unlike node, the native layer can dispatch the request's END_STREAM and body to JS
// after the response's 'finish' (node learns endOfStream with the headers), so at
// 'finish' an untouched readable does not prove the peer is stuck and an empty one does
// not prove it is not. Two timing-independent triggers cover both orderings:
//  - 'finish' with unread request bytes already buffered (the peer was mid-upload), and
//  - unread request bytes reaching JS after the response already finished
//    (ServerHttp2Session's streamData). A request with no body can produce neither.
function maybeCloseUnreadServerStream(stream: ServerHttp2Stream) {
  if (stream.destroyed || stream.closed) return;
  if (!stream.writableFinished || !stream.headersSent) return;
  // A file response (respondWithFile/FD) ends the user-facing writable while the file is
  // still being written natively, so writableFinished does not mean the response is done;
  // node never installs its auto-close hook for that path (it nulls _final), match it.
  if (stream[kFileResponseFinal] !== undefined) return;
  // Node holds the auto-close while trailers are pending: its HAS_TRAILERS flag is set by
  // respond({waitForTrailers}) and only cleared once sendTrailers() has submitted them.
  if (stream[kSendingTrailers]) return;
  if ((stream[bunHTTP2StreamStatus] & StreamState.WantTrailer) !== 0 && stream.sentTrailers === undefined) return;
  if (!stream.readableDidRead && stream.readableFlowing === null) {
    setImmediate(callStreamClose, stream);
  }
}
function serverStreamOnFinish(this: ServerHttp2Stream) {
  if (this.readableLength > 0) maybeCloseUnreadServerStream(this);
}
function callStreamClose(stream: ServerHttp2Stream) {
  if (!stream.destroyed && !stream.closed) stream.close();
}
class ServerHttp2Stream extends Http2Stream {
  headersSent = false;
  constructor(streamId, session, headers) {
    super(streamId, session, headers);
  }
  // Node registers its 'finish' -> kMaybeDestroy hook inside shutdownWritable (its
  // _final): a file response (respondWithFile/FD) nulls out _final and ends the
  // user-facing writable while the file is still being written natively, so it must
  // never install the hook - the early 'finish' would RST and truncate the transfer.
  _final(callback) {
    this.once("finish", serverStreamOnFinish);
    super._final(callback);
  }
  // Node sends the implicit response headers (:status 200) when the stream is written to before
  // respond() was called; without this the DATA frames would go out with no preceding HEADERS.
  _write(chunk, encoding, callback) {
    // `this.session === undefined` covers the window where the session was destroyed
    // synchronously but the stream-level flags only flip on nextTick - respond() would throw.
    if (!this.headersSent && !this.destroyed && !this.closed && this.session !== undefined) {
      this.respond();
    }
    super._write(chunk, encoding, callback);
  }
  _writev(data, callback) {
    if (!this.headersSent && !this.destroyed && !this.closed && this.session !== undefined) {
      this.respond();
    }
    super._writev(data, callback);
  }
  pushStream(headers, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    {
      const session = this[bunHTTP2Session];
      if (session == null || session.destroyed) {
        throw $ERR_HTTP2_PUSH_DISABLED();
      }
    }
    if (typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    // RFC 9113 §8.4: a pushed (even-id) stream cannot itself initiate a push.
    if ((this.id & 1) === 0) {
      const err = new Error("A push stream cannot initiate another push stream.");
      err.code = "ERR_HTTP2_NESTED_PUSH";
      throw err;
    }
    if (!this.pushAllowed) {
      throw $ERR_HTTP2_PUSH_DISABLED();
    }
    const session = this[bunHTTP2Session];
    const parser = session?.[bunHTTP2Native];
    if (!parser) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }
    headers = { ...headers };
    assertNoConnectionHeaders(headers);
    const sensitives = headers[sensitiveHeaders];
    // Note: the sensitiveHeaders symbol stays on the object — the native header walk skips
    // symbol keys, and deleting it here would flip the object into dictionary mode,
    // pessimizing every later property access on it.
    if (sensitives !== undefined && !$isArray(sensitives)) {
      throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
    }
    const sensitiveNames = buildSensitiveNames(headers, sensitives);
    // A PUSH_PROMISE carries a request; default the method/path/scheme/authority like node does.
    const parentRequestHeaders = this[kRequestHeaders] || this[bunHTTP2Headers];
    if (headers[HTTP2_HEADER_METHOD] === undefined) headers[HTTP2_HEADER_METHOD] = "GET";
    if (headers[HTTP2_HEADER_PATH] === undefined) headers[HTTP2_HEADER_PATH] = "/";
    if (headers[HTTP2_HEADER_SCHEME] === undefined) {
      headers[HTTP2_HEADER_SCHEME] = parentRequestHeaders?.[HTTP2_HEADER_SCHEME] || this.scheme;
    }
    if (headers[HTTP2_HEADER_AUTHORITY] === undefined && parentRequestHeaders) {
      headers[HTTP2_HEADER_AUTHORITY] = parentRequestHeaders[HTTP2_HEADER_AUTHORITY];
    }
    const pushId = parser.getNextStream();
    if (pushId === -1) {
      throw $ERR_HTTP2_OUT_OF_STREAMS();
    }
    // getNextStream() created the pushed ServerHttp2Stream via the streamStart handler.
    const pushedStream = parser.getStreamContext(pushId);
    if (pushedStream && pushedStream[bunHTTP2Headers] == null) {
      pushedStream[bunHTTP2Headers] = headers;
    }
    if (onServerStreamCreatedChannel.hasSubscribers) {
      onServerStreamCreatedChannel.publish({ stream: pushedStream, headers });
    }
    if (onServerStreamStartChannel.hasSubscribers) {
      onServerStreamStartChannel.publish({ stream: pushedStream, headers });
    }
    try {
      parser.pushPromise(this.id, pushId, headers, sensitiveNames);
    } catch (err) {
      // pushPromise() can throw synchronously (invalid token, invalid pseudo-header, oversized
      // block). The pushed stream was already created by getNextStream's streamStart; tear it
      // down so the connection count and its context root do not leak, and report the error
      // through the callback like node does.
      if (pushedStream && !pushedStream.destroyed) {
        // The PUSH_PROMISE never reached the wire; sending RST_STREAM for the reserved id would
        // be a protocol violation (the peer sees an idle stream). The skipped reset dispatch is
        // also what releases the session's bookkeeping - do that explicitly.
        pushedStream[kNeverAnnounced] = true;
        session[kReleaseUnannouncedStream](pushId);
        pushedStream.destroy(err);
      }
      process.nextTick(callback, err);
      return;
    }
    // node: a HEAD push (or options.endStream) carries no response body, so the pushed stream's
    // writable side is already ended when the callback runs; respond() then forces endStream so
    // END_STREAM rides on the response HEADERS frame.
    if (pushedStream) {
      if (headers[HTTP2_HEADER_METHOD] === HTTP2_METHOD_HEAD) {
        pushedStream[kHeadRequest] = true;
        pushedStream.end();
      } else if (options?.endStream) {
        pushedStream.end();
      }
    }
    process.nextTick(callback, null, pushedStream, headers);
  }

  respondWithFile(path, headers, options) {
    if (this.destroyed) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();

    if ($isArray(headers)) {
      // node rejects the raw-array form here (only respond() accepts it) - same
      // ERR_INVALID_ARG_TYPE shape as node v26.3.0, contradictory wording included.
      throw $ERR_INVALID_ARG_TYPE("headers", ["Array", "Object"], headers);
    }
    if (headers == undefined) {
      headers = {};
    } else if (!$isObject(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }

    if (headers[HTTP2_HEADER_STATUS] === undefined) {
      headers[HTTP2_HEADER_STATUS] = 200;
    }
    const statusCode = headers[HTTP2_HEADER_STATUS];
    options = { ...options };

    // Payload/DATA frames are not permitted in these cases
    if (
      statusCode === HTTP_STATUS_NO_CONTENT ||
      statusCode === HTTP_STATUS_RESET_CONTENT ||
      statusCode === HTTP_STATUS_NOT_MODIFIED ||
      this.headRequest
    ) {
      throw $ERR_HTTP2_PAYLOAD_FORBIDDEN(statusCode);
    }

    if (options.offset !== undefined && typeof options.offset !== "number") {
      throw $ERR_INVALID_ARG_VALUE("options.offset", options.offset);
    }
    if (options.length !== undefined && typeof options.length !== "number") {
      throw $ERR_INVALID_ARG_VALUE("options.length", options.length);
    }
    if (options.statCheck !== undefined && typeof options.statCheck !== "function") {
      throw $ERR_INVALID_ARG_VALUE("options.statCheck", options.statCheck);
    }
    this[kOwnsFd] = true;
    fs.open(path, "r", afterOpen.bind(this, options || {}, headers));
  }
  respondWithFD(fd, headers, options) {
    if (typeof fd !== "number") {
      // node accepts a FileHandle too; unwrap its descriptor.
      if (fd !== null && typeof fd === "object" && typeof fd.fd === "number") {
        fd = fd.fd;
      } else {
        const err = new TypeError(
          `The "fd" argument must be of type number or an instance of FileHandle.` +
            ` Received ${receivedValueLabel(fd)}`,
        );
        err.code = "ERR_INVALID_ARG_TYPE";
        throw err;
      }
    }
    if (this.destroyed) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();

    if ($isArray(headers)) {
      // node rejects the raw-array form here (only respond() accepts it) - same
      // ERR_INVALID_ARG_TYPE shape as node v26.3.0, contradictory wording included.
      throw $ERR_INVALID_ARG_TYPE("headers", ["Array", "Object"], headers);
    }
    if (headers == undefined) {
      headers = {};
    } else if (!$isObject(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }

    if (headers[HTTP2_HEADER_STATUS] === undefined) {
      headers[HTTP2_HEADER_STATUS] = 200;
    }
    const statusCode = headers[HTTP2_HEADER_STATUS];

    // Payload/DATA frames are not permitted in these cases
    if (
      statusCode === HTTP_STATUS_NO_CONTENT ||
      statusCode === HTTP_STATUS_RESET_CONTENT ||
      statusCode === HTTP_STATUS_NOT_MODIFIED ||
      this.headRequest
    ) {
      throw $ERR_HTTP2_PAYLOAD_FORBIDDEN(statusCode);
    }
    options = { ...options };
    if (options.offset !== undefined && typeof options.offset !== "number") {
      throw $ERR_INVALID_ARG_VALUE("options.offset", options.offset);
    }
    if (options.length !== undefined && typeof options.length !== "number") {
      throw $ERR_INVALID_ARG_VALUE("options.length", options.length);
    }
    if (options.statCheck !== undefined && typeof options.statCheck !== "function") {
      throw $ERR_INVALID_ARG_VALUE("options.statCheck", options.statCheck);
    }
    // The caller owns this fd; clear any stale flag left by a prior respondWithFile()
    // on the same stream so doSendFileFD will not close it (node semantics).
    this[kOwnsFd] = false;
    if (options.statCheck === undefined) {
      // node's processRespondWithFD runs synchronously when no statCheck is given: the
      // user-facing writable side is already closed by the time respondWithFD() returns, so a
      // stream.end() right after it is a no-op instead of ending the stream before the file.
      closeWritableForFileResponse(this);
    }
    if (fd instanceof FileHandle) {
      fs.fstat(fd.fd, doSendFileFD.bind(this, options, fd, headers));
    } else {
      fs.fstat(fd, doSendFileFD.bind(this, options, fd, headers));
    }
  }
  additionalHeaders(headers) {
    if (this.destroyed || this.closed || this.session === undefined) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }

    if (this.sentTrailers) {
      throw $ERR_HTTP2_TRAILERS_ALREADY_SENT();
    }
    if (this.headersSent) {
      throw $ERR_HTTP2_HEADERS_AFTER_RESPOND();
    }

    if (headers == undefined) {
      headers = {};
    } else if (!$isObject(headers) || $isArray(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }

    for (const name in headers) {
      if (name.startsWith(":") && name !== HTTP2_HEADER_STATUS) {
        throw $ERR_HTTP2_INVALID_PSEUDOHEADER(name);
      }
    }

    const sensitives = headers[sensitiveHeaders];
    // Note: the sensitiveHeaders symbol stays on the object — the native header walk skips
    // symbol keys, and deleting it here would flip the object into dictionary mode,
    // pessimizing every later property access on it.
    if (sensitives !== undefined && !$isArray(sensitives)) {
      throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
    }
    const sensitiveNames = buildSensitiveNames(headers, sensitives);
    // Pre-validate single-value headers in JS so a throwing additionalHeaders() leaves no partial
    // state in the shared HPACK table (same rule request() applies).
    if (this[bunHTTP2Session]?.[kStrictSingleValueFields] !== false) assertSingleValueHeaders(headers);
    let hasStatus = true;
    if (headers[HTTP2_HEADER_STATUS] === undefined) {
      headers[HTTP2_HEADER_STATUS] = 200;
      hasStatus = false;
    }
    const statusCode = headers[HTTP2_HEADER_STATUS];
    if (hasStatus) {
      if (statusCode === HTTP_STATUS_SWITCHING_PROTOCOLS) throw $ERR_HTTP2_STATUS_101();
      if (statusCode < 100 || statusCode >= 200) {
        throw $ERR_HTTP2_INVALID_INFO_STATUS(statusCode);
      }

      // Payload/DATA frames are not permitted in these cases
      if (
        statusCode === HTTP_STATUS_NO_CONTENT ||
        statusCode === HTTP_STATUS_RESET_CONTENT ||
        statusCode === HTTP_STATUS_NOT_MODIFIED ||
        this.headRequest
      ) {
        throw $ERR_HTTP2_PAYLOAD_FORBIDDEN(statusCode);
      }
    }
    const session = this[bunHTTP2Session];
    assertSession(session);
    if (!this[kInfoHeaders]) {
      this[kInfoHeaders] = [headers];
    } else {
      ArrayPrototypePush.$call(this[kInfoHeaders], headers);
    }

    session[bunHTTP2Native]?.request(this.id, undefined, headers, sensitiveNames);
  }
  respond(headers: any, options?: any) {
    if (this.destroyed || this.session === undefined) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }

    const session = this[bunHTTP2Session];
    assertSession(session);
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();
    if (this.sentTrailers) {
      throw $ERR_HTTP2_TRAILERS_ALREADY_SENT();
    }

    // Raw (flat [name, value, ...] array) headers form: the pairs are encoded
    // on the wire in their given order; a default :status is prepended and a
    // date header appended when missing. The derived object form (original-case
    // keys, array values for duplicates) backs sentHeaders.
    let rawHeadersList: any[] | null = null;
    let statusCode;
    if (headers == undefined) {
      headers = {};
    } else if ($isArray(headers)) {
      statusCode = 0;
      let statusFound = false;
      let isDateSet = false;
      // Never mutate the caller's array: the :status/date defaults below are appended to a copy.
      // Symbol-keyed own properties (the never-index list) do not survive a copy; carry it over.
      const sensitiveNamesForCopy = headers[sensitiveHeaders];
      headers = headers.slice();
      if (sensitiveNamesForCopy !== undefined) headers[sensitiveHeaders] = sensitiveNamesForCopy;
      for (let i = 0; i < headers.length; i += 2) {
        const key = headers[i];
        if (typeof key !== "string") continue;
        const lowered = key.toLowerCase();
        if (lowered === HTTP2_HEADER_STATUS) {
          statusFound = true;
          statusCode = headers[i + 1] | 0;
        } else if (lowered === HTTP2_HEADER_DATE) isDateSet = true;
      }
      if (!statusFound) {
        // Only default :status when it is genuinely absent - a present-but-invalid value (0, a
        // non-numeric string) must fall through to the range validation instead of being doubled.
        statusCode = 200;
        headers.unshift(HTTP2_HEADER_STATUS, statusCode);
      }
      const sendDateOption = options?.sendDate;
      if (!isDateSet && (sendDateOption == null || sendDateOption)) {
        headers.push(HTTP2_HEADER_DATE, utcDate());
      }
      rawHeadersList = headers;
      const headersObject = { __proto__: null };
      for (let i = 0; i < rawHeadersList.length; i += 2) {
        const key = rawHeadersList[i];
        const value = rawHeadersList[i + 1];
        const existing = headersObject[key];
        if (existing === undefined) headersObject[key] = value;
        else if ($isArray(existing)) existing.push(value);
        else headersObject[key] = [existing, value];
      }
      if (rawHeadersList[sensitiveHeaders] !== undefined) {
        headersObject[sensitiveHeaders] = rawHeadersList[sensitiveHeaders];
      }
      headers = headersObject;
    } else if (!$isObject(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }

    const sensitives = headers[sensitiveHeaders];
    // Note: the sensitiveHeaders symbol stays on the object — the native header walk skips
    // symbol keys, and deleting it here would flip the object into dictionary mode,
    // pessimizing every later property access on it.
    if (sensitives !== undefined && !$isArray(sensitives)) {
      throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
    }
    const sensitiveNames = buildSensitiveNames(headers, sensitives);
    // Pre-validate single-value headers in JS so a throwing respond() leaves no partial state in
    // the shared HPACK table (same rule request() applies).
    if (session[kStrictSingleValueFields] !== false) assertSingleValueHeaders(headers);
    // node keeps the never-index list visible on sentHeaders (symbol keys are not iterated by the
    // wire-encoding path, so re-attaching is safe).
    if (sensitives !== undefined) headers[sensitiveHeaders] = sensitives;
    if (rawHeadersList === null) {
      for (const name in headers) {
        if (headerValueIsUnsendable(headers[name])) {
          delete headers[name];
        }
      }
      if (headers[HTTP2_HEADER_STATUS] === undefined) {
        headers[HTTP2_HEADER_STATUS] = 200;
      }
      statusCode = headers[HTTP2_HEADER_STATUS] |= 0;
    }
    // RFC 9113 8.1.1 removes 101 (Switching Protocols) from HTTP/2; node uses a dedicated code.
    if (statusCode === 101) {
      throw $ERR_HTTP2_STATUS_101();
    }
    // RFC 9110: only 1xx-5xx status codes exist; node rejects anything outside 100-599.
    if (statusCode < 100 || statusCode > 599) {
      throw $ERR_HTTP2_STATUS_INVALID(statusCode);
    }
    let endStream = !!options?.endStream;
    if (
      endStream ||
      statusCode === HTTP_STATUS_NO_CONTENT ||
      statusCode === HTTP_STATUS_RESET_CONTENT ||
      statusCode === HTTP_STATUS_NOT_MODIFIED ||
      this.headRequest === true
    ) {
      // When endStream is true the HEADERS frame itself carries END_STREAM
      // and the stream moves to HALF_CLOSED_LOCAL inside native request().
      // If waitForTrailers is ALSO true the native layer dispatches
      // onWantTrailers immediately after, whose JS handler calls
      // noTrailers → sendData("", true) and emits a spurious DATA frame on
      // the already-half-closed stream (RFC 9113 §5.1 violation). Strip
      // waitForTrailers here so the native never fires that path; the JS
      // guard further down (`options?.waitForTrailers && !endStream`) only
      // covers the `_final` side and runs AFTER the native call.
      options = { ...options, endStream: true, waitForTrailers: false };
      endStream = true;
    }
    const sendDate = options?.sendDate;
    if (rawHeadersList === null && (sendDate == null || sendDate)) {
      const current_date = headers["date"];
      if (current_date == null) {
        headers["date"] = utcDate();
      }
    }

    const wireHeaders = rawHeadersList !== null ? rawHeadersList : headers;
    if (typeof options === "undefined") {
      session[bunHTTP2Native]?.request(this.id, undefined, wireHeaders, sensitiveNames);
    } else {
      session[bunHTTP2Native]?.request(this.id, undefined, wireHeaders, sensitiveNames, options);
      // Only track waitForTrailers when the HEADERS frame above did NOT end
      // the stream. Status codes 204/205/304 and HEAD requests force
      // endStream=true earlier in this method, which means the native
      // request() already wrote END_STREAM on the HEADERS frame — driving
      // the wantTrailers path from `_final` on such a stream would call
      // `noTrailers`/`emit("wantTrailers")` on an already-half-closed
      // stream and corrupt state. Use optional chaining: `options` may be
      // `null` here (typeof null === "object" enters this else branch).
      if (options?.waitForTrailers && !endStream) {
        this[bunHTTP2WaitForTrailers] = true;
      }
    }
    this.headersSent = true;
    if (onServerStreamFinishChannel.hasSubscribers) {
      onServerStreamFinishChannel.publish({ stream: this, headers, flags: 0 });
    }
    this[bunHTTP2Headers] = headers;
    if (endStream) {
      this.end();
    }

    return;
  }
}

function connectWithProtocol(protocol: string, options: Http2ConnectOptions | string | URL, listener?: Function) {
  if (protocol === "http:") {
    return net.connect(options, listener);
  }
  return tls.connect(options, listener);
}

function emitConnectNT(self, socket) {
  self.emit("connect", self, socket);
}

function destroyWithInvalidSessionNT(stream) {
  if (!stream.destroyed) stream.destroy($ERR_HTTP2_INVALID_SESSION());
}
// A gracefully closed, idle session whose settings() ACK has not arrived yet gets a short,
// bounded grace instead of an immediate destroy. Node never needs this: it coalesces the
// SETTINGS frame into the same write as the request, so its ACK always beats the response
// the caller is closing from. Bun flushes the request first, so the ACK can still be one
// round-trip away when close() runs - destroying then silently drops the user's settings
// callback and its 'localSettings' event. An ACK is mandatory (RFC 9113 6.5.3) and its
// dispatch completes the destroy at once; a peer that never sends one only delays the
// teardown by the grace, never past it.
function scheduleSettingsAckGraceNT(session) {
  if (session[kSettingsAckGraceTimer] !== undefined) return;
  const timer = setTimeout(destroyIfNotDestroyedNT, 250, session);
  // Never keeps the event loop alive: if nothing else does, the process is exiting anyway.
  timer.unref?.();
  session[kSettingsAckGraceTimer] = timer;
}
function destroyIfNotDestroyedNT(target) {
  if (!target.destroyed) target.destroy();
}
function scheduleDestroyIfNotDestroyed(target) {
  if (!target.destroyed) {
    setImmediate(destroyIfNotDestroyedNT, target);
  }
}
function rejectNoPayloadContentLengthNT(req) {
  req.rstCode = constants.NGHTTP2_PROTOCOL_ERROR;
  req.destroy(streamErrorFromCode(constants.NGHTTP2_PROTOCOL_ERROR));
}

function emitStreamErrorNT(self, stream, error, destroy, destroy_self) {
  if (stream) {
    if (stream.destroyed && stream.listenerCount("error") === 0) {
      // Already destroyed with no consumer listening: re-destroying with an
      // error re-emits it as an uncaught exception (the Windows agents hit
      // this in grpc-js test-server, "Session closed with error code 8").
      // A destroyed stream that IS listened keeps the delivery below -
      // node's errorEmitted de-dupes the re-emission, and grpc's status
      // codes ride exactly this deferred path.
      if (destroy_self) self.destroy();
      return;
    }
    if (typeof error === "number" && self != null && self[kSessionDestroyError] != null) {
      // The stream is being torn down because its session was destroyed with an error: surface
      // that session error on the stream (node semantics) instead of a generic stream error. The
      // numeric code still becomes the stream's rstCode (node uses the session's destroy code).
      if (error !== 0 && !stream.rstCode) stream.rstCode = error;
      error = self[kSessionDestroyError];
    }
    let error_instance: Error | number | undefined = undefined;
    if (stream.listenerCount("error") > 0) {
      if (typeof error === "number") {
        stream.rstCode = error;
        if (error != 0) {
          error_instance = streamErrorFromCode(error);
        }
      } else {
        error_instance = error;
      }
    }
    if (stream.readable) {
      stream.resume(); // we have a error we consume and close
      pushToStream(stream, null);
    }
    if (destroy) {
      // node marks the stream closed (and publishes the close diagnostics channel) from inside
      // _destroy, so the publish observes destroyed === true; don't pre-mark it here.
      stream.destroy(error_instance, stream.rstCode);
    } else {
      markStreamClosed(stream);
      if (error_instance) {
        stream.emit("error", error_instance);
      }
    }

    if (destroy_self) self.destroy();
  }
}
// Outbound guard: header values carrying code points above 0xFF (or raw CR/LF/NUL) cannot be
// legally serialized as an HTTP field value; node's stack drops such headers at submit time
// (response-splitting probes rely on them). Returns true when the value must be dropped.
const kForbiddenConnectionHeaders = new SafeSet([
  "connection",
  "upgrade",
  "http2-settings",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
]);
function assertNoConnectionHeaders(headers): void {
  for (const name in headers) {
    const lower = name.toLowerCase();
    if (kForbiddenConnectionHeaders.has(lower) || (lower === "te" && headers[name] !== "trailers")) {
      const err = new TypeError(`HTTP/1 Connection specific headers are forbidden: "${lower}"`);
      err.code = "ERR_HTTP2_INVALID_CONNECTION_HEADERS";
      throw err;
    }
  }
}

function headerValueIsUnsendable(value): boolean {
  if ($isArray(value)) {
    // Array-valued headers (e.g. set-cookie): unsendable if any element is.
    for (let i = 0; i < value.length; i++) {
      if (headerValueIsUnsendable(value[i])) return true;
    }
    return false;
  }
  if (typeof value !== "string") return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c > 0xff || c === 0x0d || c === 0x0a || c === 0x00) return true;
  }
  return false;
}

// RFC 9113 §8.2.1: a field value must not start or end with SP or HTAB. With strict validation
// (the default) such received fields are ignored; strictFieldWhitespaceValidation: false keeps them.
function stripInvalidWhitespaceFields(rawheaders: string[]): string[] {
  let filtered: string[] | null = null;
  for (let i = 0; i < rawheaders.length; i += 2) {
    const value = rawheaders[i + 1];
    let bad = false;
    if (typeof value === "string" && value.length > 0) {
      const first = value.charCodeAt(0);
      const last = value.charCodeAt(value.length - 1);
      bad = first === 32 || first === 9 || last === 32 || last === 9;
    }
    if (bad) {
      if (filtered === null) filtered = rawheaders.slice(0, i);
    } else if (filtered !== null) {
      filtered.push(rawheaders[i], value);
    }
  }
  return filtered === null ? rawheaders : filtered;
}
//TODO: do this in C++

// Build the never-index name map handed to the native encoder. Mirrors nghttp2's behavior:
// the user's sensitive-headers list matches case-insensitively, and `authorization` (always)
// plus short `cookie` values (< 20 chars) are never indexed even when not listed.

// node validates header constraints in JS before anything reaches the native encoder, so a
// throwing request leaves no partial state in the shared HPACK table. Mirror the single-value
// rule here: duplicated single-value fields (across case variants) and multi-element arrays for
// them throw before encoding starts.
function assertSingleValueHeaders(headers) {
  let seen = null;
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    const lower = keys[i].toLowerCase();
    if (!kSingleValueHeaders.has(lower)) continue;
    const value = headers[keys[i]];
    if (($isArray(value) && value.length > 1) || (seen !== null && seen.has(lower))) {
      throw $ERR_HTTP2_HEADER_SINGLE_VALUE(`Header field "${lower}" must only have a single value`);
    }
    if (seen === null) seen = new SafeSet();
    seen.add(lower);
  }
}

// Renders a received value the way node's determineSpecificType does for error messages.
function receivedValueLabel(value) {
  if (value === null) return "null";
  if (typeof value === "object") return "an instance of " + (value.constructor?.name || "Object");
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value === "string") return `type string ('${value}')`;
  if (typeof value === "symbol") return `type symbol (${String(value)})`;
  if (typeof value === "number") return `type number (${String(value)})`;
  return `type ${typeof value} (${JSON.stringify(value)})`;
}

function buildSensitiveNames(headers, sensitives) {
  const map = {};
  if (sensitives) {
    for (let i = 0; i < sensitives.length; i++) {
      map[String(sensitives[i]).toLowerCase()] = true;
    }
  }
  if (headers != null && typeof headers === "object") {
    // Header keys arrive in the user's casing; match case-insensitively like nghttp2.
    const keys = Object.keys(headers);
    for (let i = 0; i < keys.length; i++) {
      const lower = keys[i].toLowerCase();
      if (lower === "authorization") {
        map["authorization"] = true;
      } else if (lower === "cookie") {
        const cookie = headers[keys[i]];
        if (typeof cookie === "string" && cookie.length < 20) map["cookie"] = true;
      }
    }
  }
  return map;
}

function toHeaderObject(headers, sensitiveHeadersValue) {
  const obj = { __proto__: null, [sensitiveHeaders]: sensitiveHeadersValue };
  for (let n = 0; n < headers.length; n += 2) {
    const name = headers[n];
    let value = headers[n + 1] || "";
    if (name === HTTP2_HEADER_STATUS) value |= 0;
    const existing = obj[name];
    if (existing === undefined) {
      obj[name] = name === HTTP2_HEADER_SET_COOKIE ? [value] : value;
    } else if (!kSingleValueHeaders.has(name)) {
      switch (name) {
        case HTTP2_HEADER_COOKIE:
          // https://tools.ietf.org/html/rfc7540#section-8.1.2.5
          // "...If there are multiple Cookie header fields after decompression,
          //  these MUST be concatenated into a single octet string using the
          //  two-octet delimiter of 0x3B, 0x20 (the ASCII string "; ") before
          //  being passed into a non-HTTP/2 context."
          obj[name] = `${existing}; ${value}`;
          break;
        case HTTP2_HEADER_SET_COOKIE:
          // https://tools.ietf.org/html/rfc7230#section-3.2.2
          // "Note: In practice, the "Set-Cookie" header field ([RFC6265]) often
          // appears multiple times in a response message and does not use the
          // list syntax, violating the above requirements on multiple header
          // fields with the same name.  Since it cannot be combined into a
          // single field-value, recipients ought to handle "Set-Cookie" as a
          // special case while processing header fields."
          ArrayPrototypePush.$call(existing, value);
          break;
        default:
          // https://tools.ietf.org/html/rfc7230#section-3.2.2
          // "A recipient MAY combine multiple header fields with the same field
          // name into one "field-name: field-value" pair, without changing the
          // semantics of the message, by appending each subsequent field value
          // to the combined field value in order, separated by a comma."
          obj[name] = `${existing}, ${value}`;
          break;
      }
    }
  }
  return obj;
}

function getOrigin(origin: any, isAltSvc: boolean): string {
  if (typeof origin === "string") {
    try {
      origin = new URL(origin).origin;
    } catch (e) {
      if (isAltSvc) {
        throw $ERR_HTTP2_ALTSVC_INVALID_ORIGIN();
      } else {
        throw $ERR_INVALID_URL(origin);
      }
    }
  } else if (origin != null && typeof origin === "object") {
    origin = origin.origin;
  }
  validateString(origin, "origin");
  if (!origin || origin === "null") {
    if (isAltSvc) {
      throw $ERR_HTTP2_ALTSVC_INVALID_ORIGIN();
    } else {
      throw $ERR_HTTP2_INVALID_ORIGIN();
    }
  }

  return origin;
}
function initOriginSet(session: Http2Session) {
  let originSet = session[bunHTTP2OriginSet];
  if (originSet === undefined) {
    const socket = session[bunHTTP2Socket];
    session[bunHTTP2OriginSet] = originSet = new Set<string>();
    let hostName = socket.servername;
    if (!hostName) {
      if (socket.remoteFamily === "IPv6") {
        hostName = `[${socket.remoteAddress}]`;
      } else {
        hostName = socket.remoteAddress;
      }
    }
    let originString = `https://${hostName}`;
    if (socket.remotePort != null) originString += `:${socket.remotePort}`;
    originSet.add(originString);
  }
  return originSet;
}
function removeOriginFromSet(session: Http2Session, stream: ClientHttp2Stream) {
  const originSet = session[bunHTTP2OriginSet];
  const origin = `https://${stream.authority}`;
  if (originSet && origin) {
    originSet.delete(origin);
  }
}
class ServerHttp2Session extends Http2Session {
  [kServer]: Http2Server = null;
  /// close indicates that the session is shutting down (close() or destroy() was called)
  #closed: boolean = false;
  // One-shot destroy latch (Node: "if (this.destroyed) return;" opens destroy()).
  #destroying: boolean = false;
  /// closeCalled tracks whether close() specifically was called: `session.closed` only reports a
  /// graceful close() in node — destroy() leaves it false while `session.destroyed` flips to true.
  #closeCalled: boolean = false;
  /// connected indicates that the connection/socket is connected
  #connected: boolean = false;
  #connections: number = 0;
  #socket_proxy: Proxy<TLSSocket | Socket>;
  #parser: typeof H2FrameParser | null;
  #url: URL;
  #isServer: boolean = false;
  #alpnProtocol: string | undefined = undefined;
  #localSettings: Settings | null = null;
  #encrypted: boolean = false;
  #pendingSettingsAck: boolean = true;
  // Count of SETTINGS frames sent that the peer has not yet ACKed (the initial connection
  // SETTINGS counts as the first). node destroys the session with
  // ERR_HTTP2_MAX_PENDING_SETTINGS_ACK when this exceeds maxOutstandingSettings.
  #pendingSettingsAckCount: number = 1;
  #maxOutstandingSettings: number = 10;
  // node's Http2Settings queue: one entry per outstanding SETTINGS (initial-preface
  // seed = null), invoked after 'localSettings' when that submission's ACK arrives.
  #pendingSettingsCallbacks: Array<[Function, number] | null> = [null];
  #remoteSettings: Settings | null = null;
  #pingCallbacks: Array<[Function, number]> | null = null;
  #strictFieldWhitespaceValidation: boolean = true;
  // The SETTINGS_MAX_CONCURRENT_STREAMS value this session advertised (enforced from the moment it
  // is submitted, like nghttp2's pending local settings — not only after the peer ACKs).
  #advertisedMaxConcurrentStreams: number = Infinity;
  // Client-initiated (odd-id) streams currently open: RFC 9113 5.1.2 - only these count against
  // the limit this server advertised; its own pushed streams count against the client's setting.
  #peerInitiatedStreams: number = 0;

  static #Handlers = {
    binaryType: "buffer",
    streamStart(self: ServerHttp2Session, stream_id: number) {
      if (!self) return;
      // RFC 9113 §5.1.2: refuse peer-initiated streams that would exceed the advertised
      // SETTINGS_MAX_CONCURRENT_STREAMS. nghttp2 answers with RST_STREAM REFUSED_STREAM and never
      // surfaces the stream to the JS layer.
      if (stream_id % 2 === 1 && self.#peerInitiatedStreams >= self.#advertisedMaxConcurrentStreams) {
        self.#parser?.rstStream(stream_id, constants.NGHTTP2_REFUSED_STREAM);
        return;
      }
      self.#connections++;
      if (stream_id % 2 === 1) self.#peerInitiatedStreams++;
      const stream = new ServerHttp2Stream(stream_id, self, null);
      // Returned to the native caller, which stores it as the stream context — no
      // setStreamContext host call needed.
      return stream;
    },
    // Server handlers are NOT withStreamFrame-wrapped: streamStart runs in
    // the native handler_pair! wrap's parser-construction context, so a
    // peer-initiated stream's captured frame equals what every handler sees.
    frameError(self: ServerHttp2Session, stream: ServerHttp2Stream, frameType: number, errorCode: number) {
      if (!self || typeof stream !== "object") return;
      // Emit the frameError event with the frame type and error code
      process.nextTick(emitFrameErrorEventNT, stream, frameType, errorCode);
    },
    aborted(self: ServerHttp2Session, stream: ServerHttp2Stream, error: any, old_state: number) {
      if (!self || typeof stream !== "object") return;
      stream.rstCode = constants.NGHTTP2_CANCEL;
      // if writable and not closed emit aborted
      if (old_state != 5 && old_state != 7) {
        stream[kAborted] = true;
        stream.emit("aborted");
      }
      self.#connections--;
      if (stream.id % 2 === 1) self.#peerInitiatedStreams--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamError(self: ServerHttp2Session, stream: ServerHttp2Stream, error: number) {
      if (!self || typeof stream !== "object") return;
      self.#connections--;
      if (stream.id % 2 === 1) self.#peerInitiatedStreams--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamEnd(self: ServerHttp2Session, stream: ServerHttp2Stream, state: number) {
      if (!self || typeof stream !== "object") return;
      if (state === 7 && stream[kSendingTrailers]) {
        // The trailer frame submitted by an in-flight sendTrailers() fully closed the stream:
        // re-queue the close so it is not observable from inside sendTrailers() (node defers the
        // submission itself via setImmediate, see kSendingTrailers).
        process.nextTick(ServerHttp2Session.#Handlers.streamEnd, self, stream, state);
        return;
      }
      if (state == 6 || state == 7) {
        if (stream.readable) {
          if (!stream.rstCode) {
            stream.rstCode = 0;
          }
          pushToStream(stream, null);

          // If the user hasn't tried to consume the stream then dump the incoming data so the
          // stream can finish — but at half-close only when nothing is buffered: a consumer may
          // attach a tick later (e.g. a CONNECT tunnel piping once its socket connects) and
          // resuming with buffered data would silently discard it. At full close, dump as before.
          if ((state == 7 || stream.readableLength === 0) && stream.readableFlowing === null) {
            stream.resume();
          }
        }
      }
      // 7 = closed, in this case we already send everything and received everything
      if (state === 7) {
        stream[bunHTTP2StreamStatus] |= StreamState.NativeClosed;
        markStreamClosed(stream);
        self.#connections--;
        if (stream.id % 2 === 1) self.#peerInitiatedStreams--;
        if (stream.readable && !stream.rstCode) {
          // Clean close while data is still buffered on the readable side (e.g. the response
          // ended before the request body was consumed): node defers the destroy until the
          // consumer drains it ('end'), so the buffered request body is not lost.
          stream.once("end", destroySelfOnEnd);
        } else if (stream.writableEnded && !stream.writableFinished && !stream.destroyed) {
          // The writable side is mid-finish (an in-flight _final settled the native stream
          // synchronously): destroying now would swallow 'finish'. Node's kMaybeDestroy waits
          // for the writable side to finish before destroying a cleanly closed stream.
          stream.once("finish", destroySelfOnEnd);
        } else {
          stream.destroy();
        }
        if (self.#connections === 0 && self.#closed) {
          self.destroy();
        }
      } else if (state === 5) {
        // 5 = local closed aka write is closed
        markWritableDone(stream);
      }
    },
    streamData(self: ServerHttp2Session, stream: ServerHttp2Stream, data: Buffer) {
      if (!self || typeof stream !== "object" || !data) return;
      pushToStream(stream, data);
      // Request data arriving unread after the response finished: the peer is uploading
      // into a receive window nothing will reopen (see maybeCloseUnreadServerStream).
      maybeCloseUnreadServerStream(stream);
    },
    streamHeaders(
      self: ServerHttp2Session,
      stream: ServerHttp2Stream,
      headersTuple: [string[], Record<string, any>, string[] | undefined],
      flags: number,
    ) {
      if (!self || typeof stream !== "object" || self.closed || stream.closed) return;
      let rawheaders = headersTuple[0];
      let headers = headersTuple[1];
      if (self.#strictFieldWhitespaceValidation) {
        // stripInvalidWhitespaceFields returns its input by identity when nothing was
        // stripped (the common case) — only then can the native-built object be reused.
        const filtered = stripInvalidWhitespaceFields(rawheaders);
        if (filtered !== rawheaders) {
          rawheaders = filtered;
          headers = toHeaderObject(filtered, headersTuple[2] || []);
        }
      }
      // Remember the request headers on the stream (pushStream derives :scheme/:authority defaults
      // from them). kRequestHeaders survives respond() overwriting the bunHTTP2Headers slot. Only
      // the first HEADERS block counts - this handler also fires for trailers.
      if (stream[kRequestHeaders] === undefined) {
        stream[kRequestHeaders] = headers;
      }
      if (stream[bunHTTP2Headers] == null) {
        stream[bunHTTP2Headers] = headers;
      }
      if (headers[HTTP2_HEADER_METHOD] === HTTP2_METHOD_HEAD) {
        stream[kHeadRequest] = true;
      }
      const status = stream[bunHTTP2StreamStatus];
      if ((status & StreamState.StreamResponded) !== 0) {
        stream.emit("trailers", headers, flags, rawheaders);
      } else {
        // Set the StreamResponded bit BEFORE dispatching the 'stream' event
        // synchronously to user code. The user handler may call
        // stream.respond()/stream.end() which set other bits (WantTrailer,
        // FinalCalled, EndedCalled, WritableClosed). If we captured `status`
        // and wrote it back AFTER the emit, we'd clobber any bits set by the
        // user handler — in particular, losing WantTrailer/FinalCalled breaks
        // any later `sendTrailers()` with ERR_HTTP2_TRAILERS_NOT_READY.
        stream[bunHTTP2StreamStatus] |= StreamState.StreamResponded;
        if (onServerStreamCreatedChannel.hasSubscribers) {
          onServerStreamCreatedChannel.publish({ stream, headers });
        }
        if (onServerStreamStartChannel.hasSubscribers) {
          onServerStreamStartChannel.publish({ stream, headers });
        }
        // performServerHandshake() sessions have no owning server.
        self[kServer]?.emit("stream", stream, headers, flags, rawheaders);
        self.emit("stream", stream, headers, flags, rawheaders);
      }
    },
    localSettings(self: ServerHttp2Session, settings: Settings) {
      if (!self) return;
      self.#localSettings = settings;
      self.#pendingSettingsAck = false;
      if (self.#pendingSettingsAckCount > 0) self.#pendingSettingsAckCount--;
      const queued = self.#pendingSettingsCallbacks.shift();
      // Node's settingsCallback (lib/internal/http2/core.js) invokes the settings()
      // callback first and emits 'localSettings' after it.
      if (queued != null) queued[0](null, settings, Date.now() - queued[1]);
      self.emit("localSettings", settings);
    },
    remoteSettings(self: ServerHttp2Session, settings: Settings) {
      if (!self) return;
      self.#remoteSettings = settings;
      self.emit("remoteSettings", settings);
    },
    ping(self: ServerHttp2Session, payload: Buffer, isACK: boolean) {
      if (!self) return;
      if (!isACK) {
        // node emits 'ping' only for pings initiated by the peer, not for ACKs of our own.
        self.emit("ping", payload);
      }
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
    error(self: ServerHttp2Session, errorCode: number | string, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      if (errorCode === "ERR_HTTP2_TOO_MANY_INVALID_FRAMES") {
        self.destroy($ERR_HTTP2_TOO_MANY_INVALID_FRAMES());
        return;
      }
      // A negative code is an nghttp2-style library error for a violation our own engine
      // detected; node surfaces those as NghttpError (code ERR_HTTP2_ERROR) via
      // onSessionInternalError.
      if (typeof errorCode === "number" && errorCode < 0) {
        self.destroy(new NghttpError(errorCode));
        return;
      }
      self.destroy(errorCode as number);
    },
    wantTrailers(self: ServerHttp2Session, stream: ServerHttp2Stream) {
      if (!self || typeof stream !== "object") return;
      const status = stream[bunHTTP2StreamStatus];
      if ((status & StreamState.WantTrailer) !== 0) return;

      stream[bunHTTP2StreamStatus] = status | StreamState.WantTrailer;

      if (stream.listenerCount("wantTrailers") === 0) {
        self[bunHTTP2Native]?.noTrailers(stream.id);
      } else {
        stream.emit("wantTrailers");
      }
    },
    goaway(self: ServerHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      if (self.destroyed) return;
      self[kGoawayCode] = errorCode;
      self.emit("goaway", errorCode, lastStreamId, opaqueData || Buffer.allocUnsafe(0));
      if (errorCode === constants.NGHTTP2_NO_ERROR) {
        // Graceful shutdown: no new streams, existing ones may finish.
        self.close();
      } else if (self.closed && self.#connections === 0) {
        // Mutual teardown: this side already sent its own graceful GOAWAY
        // (close()) and every stream is done, so the peer's error code cannot
        // affect anything user-visible - both ends agreed the connection is
        // over. Destroy cleanly instead of surfacing a session error: node
        // never observes this state (its socket is torn down before the
        // peer's late GOAWAY could be read - grpc-js forceShutdown sends
        // GOAWAY(NGHTTP2_CANCEL) at a client that just close()d, and on the
        // Windows agents the frame deterministically arrived first).
        self.destroy();
      } else {
        self.#parser?.emitErrorToAllStreams(errorCode);
        // Like Node, destroy with an error but send our own goaway with
        // NGHTTP2_NO_ERROR since this side had no error.
        self.destroy(sessionErrorFromCode(errorCode), constants.NGHTTP2_NO_ERROR);
      }
    },
    end(self: ServerHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.destroy();
    },
    write(self: ServerHttp2Session, buffer: Buffer) {
      if (!self) return -1;
      const socket = self[bunHTTP2Socket];
      if (socket && !socket.writableEnded && self.#connected) {
        // redirect writes to socket
        return socket.write(buffer) ? 1 : 0;
      }
      return -1;
    },
  };
  #onRead(data: Buffer) {
    // Inbound traffic refreshes the session's idle timer (node's [kUpdateTimer]).
    if (this[kTimeout]) this[kTimeout].refresh();
    this.#parser?.read(data);
  }
  #onClose() {
    const parser = this.#parser;
    if (parser) {
      parser.emitAbortToAllStreams();
      parser.forEachStream(streamSocketClosed);
      parser.detach();
      this.#parser = null;
    }
    // Like Node's socketOnClose, a dead socket always tears the session down
    // (close() followed by closeSession() upstream). close() alone is not
    // enough: it early-returns once a received GOAWAY has already marked the
    // session closed, and the destroy it deferred to the last stream's close
    // never comes once the peer is gone — leaving the session (and the
    // server's open-connection count) alive forever.
    this.close();
    this.destroy();
  }
  #onError(error: Error) {
    // Node's socketOnError reads `const session = this[kSession]` and does
    // nothing when it is undefined: destroying the session detaches it from the
    // socket, so a transport error that lands afterwards (the peer's RST racing
    // our own teardown - routine on Windows loopback) is not re-reported on an
    // already-destroyed session.
    if (this.destroyed) {
      return;
    }
    if (isEconnresetAfterGoaway(this, error)) {
      this.destroy();
      return;
    }
    if (this.listenerCount("error") === 0 && (error as NodeJS.ErrnoException)?.code === "ECONNRESET") {
      // An unobserved transport teardown (the peer dropped a connection
      // nobody is listening to anymore): destroy quietly - the destroy still
      // errors any remaining streams - instead of re-emitting on a session
      // with no 'error' listener and crashing the process. (The server
      // attaches sessionOnError at accept time, so this branch only matters
      // for standalone sessions.) Anything that is not teardown noise keeps
      // Node's EventEmitter contract and surfaces when unobserved.
      this.destroy();
      return;
    }
    this.destroy(error);
  }
  #onTimeout() {
    const parser = this.#parser;
    if (parser) {
      parser.forEachStream(emitTimeout);
    }
    this.emit("timeout");
  }
  #onDrain() {
    const parser = this.#parser;
    if (parser) {
      parser.flush();
    }
  }
  altsvc(alt: string, originOrStream) {
    const MAX_LENGTH = 16382;
    const parser = this.#parser;
    if (this.destroyed || !parser) throw $ERR_HTTP2_INVALID_SESSION();
    let stream = 0;
    let origin;

    if (typeof originOrStream === "string") {
      origin = getOrigin(originOrStream, true);
    } else if (typeof originOrStream === "number") {
      if (originOrStream >>> 0 !== originOrStream || originOrStream === 0) {
        throw $ERR_OUT_OF_RANGE("originOrStream", `> 0 && < ${2 ** 32}`, originOrStream);
      }
      stream = originOrStream;
    } else if (originOrStream !== undefined) {
      // Allow origin to be passed a URL or object with origin property
      if (originOrStream !== null && typeof originOrStream === "object") origin = originOrStream.origin;
      // Note: if originOrStream is an object with an origin property other
      // than a URL, then it is possible that origin will be malformed.
      // We do not verify that here. Users who go that route need to
      // ensure they are doing the right thing or the payload data will
      // be invalid.
      if (typeof origin !== "string") {
        throw $ERR_INVALID_ARG_TYPE("originOrStream", ["string", "number", "URL", "object"], originOrStream);
      } else if (!origin) {
        throw $ERR_HTTP2_ALTSVC_INVALID_ORIGIN();
      } else {
        origin = getOrigin(origin, true);
      }
    }

    validateString(alt, "alt");

    if (!kQuotedString.test(alt)) {
      throw $ERR_INVALID_CHAR("alt");
    }
    origin = origin || "";
    if (Buffer.byteLength(origin) + Buffer.byteLength(alt) > MAX_LENGTH) {
      throw $ERR_HTTP2_ALTSVC_LENGTH();
    }
    parser.altsvc(origin, alt, stream);
  }
  origin(...origins) {
    const parser = this.#parser;
    if (this.destroyed || !parser) throw $ERR_HTTP2_INVALID_SESSION();
    let length = origins.length;
    if (length === 0) {
      return;
    }
    if (length === 1) {
      return parser.origin(getOrigin(origins[0], false));
    }

    let validOrigins: string[] = new Array(length);
    for (let i = 0; i < length; i++) {
      validOrigins[i] = getOrigin(origins[i], false);
    }
    parser.origin(validOrigins);
  }

  [kReleaseUnannouncedStream](streamId: number) {
    // A pushed stream torn down before its PUSH_PROMISE left: no reset dispatch will arrive, so
    // release the connection slot and the native stream context here.
    this.#connections--;
    this.#parser?.setStreamContext(streamId, undefined);
  }

  constructor(socket: TLSSocket | Socket, options?: Http2ConnectOptions, server?: Http2Server) {
    super();
    // node: a socket can only ever be bound to a single Http2Session
    // (ERR_HTTP2_SOCKET_BOUND is not in the native error-code registry; construct it directly).
    if (socket[kBoundSession] !== undefined) {
      const err = new Error("The socket is already bound to an Http2Session");
      err.code = "ERR_HTTP2_SOCKET_BOUND";
      throw err;
    }
    socket[kBoundSession] = this;
    this[kServer] = server;
    if (options?.strictFieldWhitespaceValidation === false) {
      this.#strictFieldWhitespaceValidation = false;
    }
    this[kStrictSingleValueFields] = options?.strictSingleValueFields !== false;
    if (server) {
      server[kSessions].add(this);
    }
    this.#connected = true;
    if (socket instanceof TLSSocket) {
      // server will receive the preface to know if is or not h2
      this.#alpnProtocol = socket.alpnProtocol || "h2";
    } else {
      this.#alpnProtocol = "h2c";
    }
    this[bunHTTP2Socket] = socket;
    const nativeSocket = socket._handle;
    this[kDeferWriteCallback] = deferWriteCallbackForSocket(nativeSocket);
    this.#encrypted = socket instanceof TLSSocket;

    if (typeof options?.maxOutstandingSettings === "number" && options.maxOutstandingSettings >= 1) {
      this.#maxOutstandingSettings = options.maxOutstandingSettings;
    }
    const advertisedMaxConcurrentStreams = options?.settings?.maxConcurrentStreams ?? options?.maxConcurrentStreams;
    if (typeof advertisedMaxConcurrentStreams === "number") {
      this.#advertisedMaxConcurrentStreams = advertisedMaxConcurrentStreams;
    }

    if (options?.settings !== undefined) {
      validateSettings(options.settings);
    }
    const nativeSettings = serverNativeSettings(options);
    this.#localSettings = initialLocalSettings(nativeSettings);
    this.#parser = new H2FrameParser({
      native: nativeSocket,
      context: this,
      // RFC 9113 §6.5.2: a server MUST NOT send SETTINGS_ENABLE_PUSH with a
      // value other than 0 — any non-zero value is treated by a client as a
      // PROTOCOL_ERROR (nghttp2 reports this as callback failure). When the
      // caller asked for enablePush it is forced to false; when it is absent
      // the setting is simply never serialized (node's initial SETTINGS frame
      // is empty for default options).
      settings: nativeSettings,
      type: 0, // server type
      handlers: ServerHttp2Session.#Handlers,
    });
    socket.on("close", this.#onClose.bind(this));
    socket.on("error", this.#onError.bind(this));
    socket.on("timeout", this.#onTimeout.bind(this));
    socket.on("data", this.#onRead.bind(this));
    socket.on("drain", this.#onDrain.bind(this));

    process.nextTick(emitConnectNT, this, socket);
  }

  get originSet() {
    if (this.encrypted) {
      return Array.from(initOriginSet(this));
    }
  }

  get alpnProtocol() {
    return this.#alpnProtocol;
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
    return this.#closeCalled;
  }

  get remoteSettings() {
    if (this.destroyed || this.connecting) return {};
    return (this.#remoteSettings ??= getDefaultSettings());
  }

  get localSettings() {
    if (this.destroyed || this.connecting) return {};
    return (this.#localSettings ??= getDefaultSettings());
  }

  get pendingSettingsAck() {
    return this.#pendingSettingsAck;
  }

  get type() {
    return 0;
  }

  get socket() {
    if (this.#socket_proxy) return this.#socket_proxy;
    const socket = this[bunHTTP2Socket];
    if (!socket) return null;
    this.#socket_proxy = new Proxy(this, proxySocketHandler);
    return this.#socket_proxy;
  }
  get state() {
    return this.#parser?.getCurrentState();
  }

  get [bunHTTP2Native]() {
    return this.#parser;
  }

  unref() {
    // Generic-stream sockets (e.g. duplexPair) have no unref; node treats it as a no-op.
    const socket = this[bunHTTP2Socket];
    if (typeof socket?.unref === "function") return socket.unref();
  }
  ref() {
    const socket = this[bunHTTP2Socket];
    if (typeof socket?.ref === "function") return socket.ref();
  }
  setTimeout(msecs, callback) {
    // node's setStreamTimeout: the session owns its own unref'd idle timer under kTimeout
    // (refreshed on inbound frames and writes), it does not arm the socket's timeout.
    return setSessionTimeout.$call(this, msecs, callback);
  }

  ping(payload, callback) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();
    if (typeof payload === "function") {
      callback = payload;
      payload = undefined;
    }
    if (payload) {
      validateBuffer(payload, "payload");
      if (payload.byteLength !== 8) throw $ERR_HTTP2_PING_LENGTH();
    }
    validateFunction(callback, "callback");

    const cb = makeHttp2Ping(callback);
    const parser = this.#parser;
    if (!parser || !this[bunHTTP2Socket]) {
      process.nextTick(cb, $ERR_HTTP2_PING_CANCEL(), 0, payload);
      return false;
    }
    if (parser.ping(payload || kEmptyPingPayload) === false) {
      process.nextTick(cb, $ERR_HTTP2_PING_CANCEL(), 0, payload);
      return false;
    }
    if (this.#pingCallbacks) {
      this.#pingCallbacks.push([cb, Date.now()]);
    } else {
      this.#pingCallbacks = [[cb, Date.now()]];
    }
    return true;
  }
  goaway(code = NGHTTP2_NO_ERROR, lastStreamID = 0, opaqueData) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    if (opaqueData !== undefined) {
      validateBuffer(opaqueData, "opaqueData");
    }
    validateInteger(code, "code", 0, kMaxUint32);
    validateNumber(lastStreamID, "lastStreamID");
    return this.#parser?.goaway(code, lastStreamID, opaqueData);
  }

  setLocalWindowSize(windowSize) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    validateWindowSize(windowSize);
    return this.#parser?.setLocalWindowSize?.(windowSize);
  }

  settings(settings: Settings, callback?) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();
    if (callback !== undefined && typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    // node treats an omitted/undefined settings object as an empty update.
    if (settings === undefined) settings = {} as Settings;
    // Validate the caller-supplied object FIRST so null / arrays / primitives
    // still throw ERR_INVALID_ARG_TYPE — spreading ({ ...null }) would hide
    // these from the type guard in validateSettings.
    validateSettings(settings);
    // RFC 9113 §6.5.2: a server MUST NOT advertise SETTINGS_ENABLE_PUSH != 0.
    // Force-override whatever the caller passes so a mid-connection SETTINGS
    // frame stays compliant (the initial SETTINGS frame already clamps this
    // in ServerHttp2Session's constructor). Clients still accept `enablePush`
    // via their own `settings()` method.
    settings = { ...settings, enablePush: false };
    if (typeof settings.maxConcurrentStreams === "number") {
      this.#advertisedMaxConcurrentStreams = settings.maxConcurrentStreams;
    }
    // node: enforce maxOutstandingSettings - the session is destroyed with
    // ERR_HTTP2_MAX_PENDING_SETTINGS_ACK when too many SETTINGS are un-ACKed.
    this.#pendingSettingsAckCount++;
    if (this.#pendingSettingsAckCount > this.#maxOutstandingSettings) {
      this.destroy($ERR_HTTP2_MAX_PENDING_SETTINGS_ACK(), constants.NGHTTP2_INTERNAL_ERROR);
      return;
    }
    this.#pendingSettingsAck = true;
    this.#parser?.settings(settings);
    // The frame is queued on the native session; flush it now (as close() does for its
    // GOAWAY) instead of waiting for the next unrelated write. Node schedules a session
    // write for every settings() call, so its SETTINGS goes out with the current batch -
    // a late frame here means the ACK trails the peer's response and a session closed at
    // that response's end never resolves the settings callback.
    this.#parser?.flush?.();
    // Queue the callback so this call's own ACK invokes it (after 'localSettings');
    // the null seed absorbs the initial-preface ACK that has no user callback.
    this.#pendingSettingsCallbacks.push(typeof callback === "function" ? [callback, Date.now()] : null);
  }

  // Gracefully closes the Http2Session, allowing any existing streams to complete on their own and preventing new Http2Stream instances from being created. Once closed, http2session.destroy() might be called if there are no open Http2Stream instances.
  // If specified, the callback function is registered as a handler for the 'close' event.
  close(callback?: Function) {
    if (this.#closed || this.destroyed) return;
    this.#closed = true;
    this.#closeCalled = true;

    if (typeof callback === "function") {
      this.once("close", callback);
    }
    // node submits a graceful GOAWAY as soon as close() is called; the peer observes the shutdown
    // ('goaway' event) while in-flight streams are still allowed to finish. The session is only
    // destroyed once there is nothing in flight, and never before the GOAWAY had a chance to leave.
    this.goaway(constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
    this[kGoawaySent] = true;
    this.#parser?.flush?.();
    if (this.#connections === 0) {
      setImmediate(destroyIfNotDestroyedNT, this);
    }
  }

  destroy(error: Error | number | undefined = NGHTTP2_NO_ERROR, code?: number) {
    // Node's destroy() is idempotent - "if (this.destroyed) return;" is its
    // first line - so a second destroy (e.g. the received-GOAWAY handler
    // destroying with a session error after a socket error's destroy already
    // ran re-entrantly out of the 'goaway' emit) never re-runs the teardown or
    // re-emits 'error' on a session whose one-shot listeners are consumed.
    // Guard on a latch, not the destroyed getter: that getter reads "socket
    // detached", which #onError sets before calling in here, and the
    // error-carrying destroy must still run once.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js (Http2Session#destroy)
    if (this.#destroying) {
      return;
    }
    this.#destroying = true;
    try {
      const server = this[kServer];
      if (server) {
        server[kSessions].delete(this);
      }
      if (this[kTimeout]) {
        clearTimeout(this[kTimeout]);
        this[kTimeout] = null;
      }
      cancelPendingPings(this.#pingCallbacks);
      this.#pingCallbacks = null;
      if (typeof error === "number") {
        code = error;
        error = code !== NGHTTP2_NO_ERROR ? $ERR_HTTP2_SESSION_ERROR(code) : undefined;
      }
      if (code === undefined && error != null) {
        code = constants.NGHTTP2_INTERNAL_ERROR;
      }
      if (error) {
        // Streams torn down by this destroy surface the same session error (node semantics).
        this[kSessionDestroyError] = error;
      }

      const socket = this[bunHTTP2Socket];
      if (!this.#connected) return;
      this.#closed = true;
      this.#connected = false;
      if (socket) {
        if (!this[kGoawaySent] || code) {
          // close() already announced a graceful shutdown - re-sending NO_ERROR would be redundant
          // and double-fires the peer's 'goaway' event. An error code is new information, though:
          // a destroy(err) after close() must still put the error GOAWAY on the wire.
          this.goaway(code || constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
        }
        if (error) {
          // node's finishSessionClose destroys the socket when the session dies
          // with an error (a misbehaving peer must observe the connection going
          // away) - but it still ends first and destroys a tick later, so the
          // final GOAWAY flushes behind a FIN instead of an abortive close (see
          // endThenDestroySessionSocket).
          endThenDestroySessionSocket(socket, error);
        } else {
          // Node's finishSessionClose: "If we're gracefully closing the socket,
          // call resume() so we can detect the peer closing in case
          // binding.Http2Session is already gone." Without a reader, unread
          // inbound bytes (a late GOAWAY from the peer) turn the close into an
          // RST, which the peer surfaces as read ECONNRESET (routine on Windows
          // loopback - the same reason Node delays the error-path destroy).
          // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1188
          socket.resume();
          socket.end();
        }
      }
      const parser = this.#parser;
      if (parser) {
        // node destroys every open stream synchronously from inside session.destroy(); the native
        // dispatch below still runs for connection bookkeeping, but by then each stream is already
        // ended + destroyed (a write() racing the destroy reports write-after-end without 'error').
        // Like Node's Http2Stream._destroy: a received GOAWAY's code takes
        // precedence over the destroy code when streams are torn down.
        const streamRstCode = this[kGoawayCode] || code || constants.NGHTTP2_NO_ERROR;
        parser.forEachStream(
          FunctionPrototypeBind.$call(destroyStreamForSessionDestroy, undefined, error, streamRstCode),
        );
        parser.emitErrorToAllStreams(streamRstCode);
        parser.detach();
        this.#parser = null;
      }
    } catch (e) {
      // A throwing destroy did not destroy: argument validation (goaway's
      // validateInteger, the native session rejecting a non-numeric error
      // code) throws mid-teardown, and a corrected retry must still run.
      this.#destroying = false;
      throw e;
    }
    this[bunHTTP2Socket] = null;

    // Read-and-clear the frame first: emitting 'error' with no listener throws,
    // which would skip the clear and leave a retained session pinning the store.
    const asyncFrame = this[bunHTTP2AsyncContextFrame];
    this[bunHTTP2AsyncContextFrame] = undefined;
    if (error) {
      runInFrame(asyncFrame, this.emit, this, "error", error);
    }
    // node emits the session 'close' event asynchronously (a listener attached right after
    // close()/destroy() returns must still observe it).
    process.nextTick(emitSessionCloseNT, this, asyncFrame);
  }
}
function emitTimeout(session: ClientHttp2Session) {
  session.emit("timeout");
}
// Outbound-progress snapshot taken the last time the session's idle timer expired while writes
// were still pending (see sessionTimerExpired / node's chunksSentSinceLastWrite).
const kTimeoutBytesSnapshot = Symbol("timeoutBytesSnapshot");
const kTimeoutWrittenSnapshot = Symbol("timeoutWrittenSnapshot");
let sessionHasPendingWrite = false;
function checkStreamWritePending(stream: Http2Stream) {
  if (stream.writableLength > 0) sessionHasPendingWrite = true;
}
// node setStreamTimeout (lib/internal/stream_base_commons.js): the session owns an unref'd idle
// timer stored under kTimeout; activity (inbound frames, writes) refreshes it.
function setSessionTimeout(this: Http2Session, msecs, callback) {
  if (this.destroyed) return this;
  this.timeout = msecs;
  msecs = getTimerDuration(msecs, "msecs");
  clearTimeout(this[kTimeout]);
  this[kTimeout] = null;
  if (msecs === 0) {
    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.removeListener("timeout", callback);
    }
  } else {
    // Snapshot the monotonic written counter at arm time so the first expiry
    // only refreshes if bytes actually went out during the period (see
    // sessionTimerExpired for why the native handle's counter, not the JS
    // getter's drain-driven mirror).
    this[kTimeoutWrittenSnapshot] =
      this[bunHTTP2Socket]?._handle?.bytesWritten ?? this[bunHTTP2Socket]?.bytesWritten ?? 0;
    this[kTimeout] = setTimeout(sessionTimerExpired, msecs, this).unref();
    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.once("timeout", callback);
    }
  }
  return this;
}

// Node's finishSessionClose error path: socket.end() flushes and sends the FIN
// first, and the hard destroy runs a tick later - "If session.destroy() was
// called, destroy the underlying socket. Delay it a bit to try to avoid
// ECONNRESET on Windows" - so the peer reads our final frames off a FIN'd
// socket instead of observing an abortive close.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1188
function destroySessionSocketDelayedNT(socket, error) {
  if (!socket.destroyed) {
    socket.destroy(error);
  }
}
function endThenDestroySessionSocket(socket, error) {
  socket.end(() => setImmediate(destroySessionSocketDelayedNT, socket, error));
}
// node callTimeout (lib/internal/http2/core.js): when the timer expires while writes are still in
// flight and bytes have reached the wire since the previous expiry, the session is not idle —
// refresh instead of emitting 'timeout' (a large flow-controlled response trickling out to a slow
// peer must not be treated as an idle connection).
function sessionTimerExpired(session: Http2Session) {
  if (session.destroyed) return;
  const parser = session[bunHTTP2Native];
  if (parser) {
    // Node compares a monotonic chunks-sent counter, not instantaneous buffer
    // levels: a write that filled and fully drained between two expiries is
    // still progress, and sampling the (empty) buffer would misread it as an
    // idle session. The native handle's bytesWritten is the live cumulative
    // counter (advanced by the parser's direct native writes); the JS socket's
    // getter only mirrors it on drain events, which the native write path does
    // not raise - reading the mirror missed every native write on Windows.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js (callTimeout)
    const sessionSocket = session[bunHTTP2Socket];
    const bytesWritten = sessionSocket?._handle?.bytesWritten ?? sessionSocket?.bytesWritten ?? 0;
    if (bytesWritten !== (session[kTimeoutWrittenSnapshot] ?? 0)) {
      session[kTimeoutWrittenSnapshot] = bytesWritten;
      session[kTimeout]?.refresh();
      return;
    }
    sessionHasPendingWrite = false;
    parser.forEachStream(checkStreamWritePending);
    // Bytes still queued natively (flow-control or socket backpressure). A change since the
    // previous expiry means the pending writes are draining (or growing) — not an idle session.
    const nativeBuffered = parser.bufferSize();
    const previousBuffered = session[kTimeoutBytesSnapshot] ?? 0;
    if (sessionHasPendingWrite || nativeBuffered > 0 || previousBuffered > 0) {
      if (nativeBuffered !== previousBuffered) {
        session[kTimeoutBytesSnapshot] = nativeBuffered;
        session[kTimeout]?.refresh();
        return;
      }
    }
    parser.forEachStream(emitTimeout);
  }
  session.emit("timeout");
}
function destroySelfOnEnd(this: Http2Stream) {
  this.destroy();
}
function streamCancel(stream: Http2Stream) {
  stream.close(NGHTTP2_CANCEL);
}

// After the socket is gone a graceful close can never complete — the parser
// is detached, so the stream's writable side has nothing left to flush
// through and 'finish'/'close' would never fire. Mirror Node's closeSession,
// which hard-destroys every stream that is still alive after the
// close(NGHTTP2_CANCEL) pass.
function streamSocketClosed(stream: Http2Stream) {
  if (!stream.destroyed) {
    stream.destroy();
  }
}
// A stream whose session was close()d before the socket finished connecting never reached the
// peer; node destroys it with ERR_HTTP2_GOAWAY_SESSION (no $ERR intrinsic exists for this code).
function rejectStreamAboveGoawayLastId(lastStreamId: number, stream: Http2Stream) {
  if (typeof stream?.id === "number" && stream.id > lastStreamId) {
    streamRejectedByGoawaySession(stream);
  }
}
function streamRejectedByGoawaySession(stream: Http2Stream) {
  if (!stream.destroyed) {
    const err = new Error("New streams cannot be created after receiving a GOAWAY");
    err.code = "ERR_HTTP2_GOAWAY_SESSION";
    // nghttp2 closes unprocessed streams with REFUSED_STREAM, the signal clients (grpc) treat
    // as safely retryable on a fresh connection.
    stream.rstCode = constants.NGHTTP2_REFUSED_STREAM;
    stream.destroy(err);
  }
}
class ClientHttp2Session extends Http2Session {
  /// close indicates that the session is shutting down (close() or destroy() was called)
  #closed: boolean = false;
  // One-shot destroy latch (Node: "if (this.destroyed) return;" opens destroy()).
  #destroying: boolean = false;
  /// closeCalled tracks whether close() specifically was called: `session.closed` only reports a
  /// graceful close() in node — destroy() leaves it false while `session.destroyed` flips to true.
  #closeCalled: boolean = false;
  /// connected indicates that the connection/socket is connected
  #connected: boolean = false;
  #connections: number = 0;

  #socket_proxy: Proxy<TLSSocket | Socket>;
  #parser: typeof H2FrameParser | null;
  #url: URL;
  #authority: string;
  #alpnProtocol: string | undefined = undefined;
  #localSettings: Settings | null = null;
  #encrypted: boolean = false;
  #pendingSettingsAck: boolean = true;
  // Count of SETTINGS frames sent that the peer has not yet ACKed (the initial connection
  // SETTINGS counts as the first). node destroys the session with
  // ERR_HTTP2_MAX_PENDING_SETTINGS_ACK when this exceeds maxOutstandingSettings.
  #pendingSettingsAckCount: number = 1;
  #maxOutstandingSettings: number = 10;
  // node's Http2Settings queue: one entry per outstanding SETTINGS (initial-preface
  // seed = null), invoked after 'localSettings' when that submission's ACK arrives.
  #pendingSettingsCallbacks: Array<[Function, number] | null> = [null];
  #remoteSettings: Settings | null = null;
  #pingCallbacks: Array<[Function, number]> | null = null;
  // RFC 9113 reserved (pushed) streams the peer may have open at once (node session option).
  #maxReservedRemoteStreams: number = 200;
  #reservedStreamsCount: number = 0;
  #strictFieldWhitespaceValidation: boolean = true;
  // Client-side SETTINGS_MAX_CONCURRENT_STREAMS accounting: requests whose HEADERS frame has been
  // submitted and whose stream has not closed yet, plus the queue of requests waiting for a slot
  // (node returns a pending stream with no id and submits it once a slot frees).
  #activeRequestCount: number = 0;
  #pendingRequests: Array<{ req: ClientHttp2Stream; headers: any; sensitiveNames: any; options: any }> | null = null;

  static #Handlers = {
    binaryType: "buffer",
    streamStart(self: ClientHttp2Session, stream_id: number) {
      if (!self) return;
      self.#connections++;
      if (stream_id % 2 === 0) {
        // A pushed (even-id) stream announced by the server: its context object must be a stream,
        // not a session. Returned to the native caller, which stores it as the stream context.
        const stream = new ClientHttp2Stream(stream_id, self, null);
        return stream;
      }
    },
    streamPush(
      self: ClientHttp2Session,
      pushId: number,
      headersTuple: [string[], Record<string, any>, string[] | undefined],
      flags: number,
    ) {
      if (!self) return;
      if (self.#reservedStreamsCount >= self.#maxReservedRemoteStreams) {
        // Too many reserved (pushed) streams: refuse this one (node cancels it instead of
        // surfacing it).
        self.#parser?.rstStream(pushId, constants.NGHTTP2_CANCEL);
        return;
      }
      self.#reservedStreamsCount++;
      // PUSH_PROMISE: surface the server-pushed stream (with its REQUEST headers) on the session
      // 'stream' event; its eventual response HEADERS will fire 'push' on the pushed stream.
      let rawheaders = headersTuple[0];
      let headers = headersTuple[1];
      if (self.#strictFieldWhitespaceValidation) {
        // stripInvalidWhitespaceFields returns its input by identity when nothing was
        // stripped (the common case) — only then can the native-built object be reused.
        const filtered = stripInvalidWhitespaceFields(rawheaders);
        if (filtered !== rawheaders) {
          rawheaders = filtered;
          headers = toHeaderObject(filtered, headersTuple[2] || []);
        }
      }
      const pushedStream = new ClientHttp2Stream(pushId, self, headers);
      pushedStream[kPush] = true;
      pushedStream.once("close", () => {
        self.#reservedStreamsCount--;
      });
      self.#connections++;
      self.#parser?.setStreamContext(pushId, pushedStream);
      if (onClientStreamCreatedChannel.hasSubscribers) {
        onClientStreamCreatedChannel.publish({ stream: pushedStream, headers });
      }
      if (onClientStreamStartChannel.hasSubscribers) {
        onClientStreamStartChannel.publish({ stream: pushedStream, headers });
      }
      self.emit("stream", pushedStream, headers, flags, rawheaders);
    },
    frameError: withStreamFrame(
      (self: ClientHttp2Session, stream: ClientHttp2Stream, frameType: number, errorCode: number) => {
        if (!self || typeof stream !== "object") return;
        // Emit the frameError event with the frame type and error code
        process.nextTick(emitFrameErrorEventNT, stream, frameType, errorCode);
      },
    ),
    aborted: withStreamFrame((self: ClientHttp2Session, stream: ClientHttp2Stream, error: any, old_state: number) => {
      if (!self || typeof stream !== "object") return;
      stream.rstCode = constants.NGHTTP2_CANCEL;
      // if writable and not closed emit aborted
      if (old_state != 5 && old_state != 7) {
        stream[kAborted] = true;
        stream.emit("aborted");
      }
      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    }),
    streamError: withStreamFrame((self: ClientHttp2Session, stream: ClientHttp2Stream, error: number) => {
      if (!self || typeof stream !== "object") return;

      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    }),
    streamEnd: withStreamFrame((self: ClientHttp2Session, stream: ClientHttp2Stream, state: number) => {
      if (!self || typeof stream !== "object") return;
      if (state === 7 && stream[kSendingTrailers]) {
        // The trailer frame submitted by an in-flight sendTrailers() fully closed the stream:
        // re-queue the close so it is not observable from inside sendTrailers() (node defers the
        // submission itself via setImmediate, see kSendingTrailers).
        process.nextTick(ClientHttp2Session.#Handlers.streamEnd, self, stream, state);
        return;
      }
      if (state == 6 || state == 7) {
        if (stream.readable) {
          if (!stream.rstCode) {
            stream.rstCode = 0;
          }
          // Push a null so the stream can end whenever the client consumes
          // it completely.
          pushToStream(stream, null);
          stream.read(0);
        }
      }

      // 7 = closed, in this case we already send everything and received everything
      if (state === 7) {
        stream[bunHTTP2StreamStatus] |= StreamState.NativeClosed;
        markStreamClosed(stream);
        self.#connections--;
        if (stream.readable && !stream.rstCode) {
          // Clean close while data is still buffered on the readable side: node defers the
          // destroy until the consumer drains it ('end'), so a late-attaching reader does not
          // lose data.
          stream.once("end", destroySelfOnEnd);
        } else if (stream.writableEnded && !stream.writableFinished && !stream.destroyed) {
          // The writable side is mid-finish (an in-flight _final settled the native stream
          // synchronously): destroying now would swallow 'finish'. Node's kMaybeDestroy waits
          // for the writable side to finish before destroying a cleanly closed stream.
          stream.once("finish", destroySelfOnEnd);
        } else {
          stream.destroy();
        }
        if (self.#connections === 0 && self.#closed) {
          // Deferred like close()'s own destroy: this runs inside a native dispatch
          // batch, and frames the engine already received but has not dispatched yet
          // must still reach JS. An outstanding settings() ACK gets a bounded grace
          // (see scheduleSettingsAckGraceNT); its arrival completes the destroy.
          if (self.#pendingSettingsAckCount > 0) scheduleSettingsAckGraceNT(self);
          else setImmediate(destroyIfNotDestroyedNT, self);
        }
      } else if (state === 5) {
        // 5 = local closed aka write is closed
        markWritableDone(stream);
      }
    }),
    streamData: withStreamFrame((self: ClientHttp2Session, stream: ClientHttp2Stream, data: Buffer) => {
      if (!self || typeof stream !== "object" || !data) return;
      pushToStream(stream, data);
    }),
    streamHeaders: withStreamFrame(
      (
        self: ClientHttp2Session,
        stream: ClientHttp2Stream,
        headersTuple: [string[], Record<string, any>, string[] | undefined],
        flags: number,
      ) => {
        if (!self || typeof stream !== "object" || stream.rstCode) return;
        let rawheaders = headersTuple[0];
        let headers = headersTuple[1];
        if (self.#strictFieldWhitespaceValidation) {
          // stripInvalidWhitespaceFields returns its input by identity when nothing was
          // stripped (the common case) — only then can the native-built object be reused.
          const filtered = stripInvalidWhitespaceFields(rawheaders);
          if (filtered !== rawheaders) {
            rawheaders = filtered;
            headers = toHeaderObject(filtered, headersTuple[2] || []);
          }
        }
        const status = stream[bunHTTP2StreamStatus];
        const header_status = headers[HTTP2_HEADER_STATUS];
        if (header_status === HTTP_STATUS_CONTINUE) {
          stream.emit("continue");
        }

        if ((status & StreamState.StreamResponded) !== 0) {
          stream.emit("trailers", headers, flags, rawheaders);
        } else {
          if (header_status >= 100 && header_status < 200) {
            stream.emit("headers", headers, flags, rawheaders);
          } else {
            // Set the bit BEFORE dispatching synchronously to user code — a
            // 'response' handler that mutates stream state would otherwise be
            // clobbered by a stale read-modify-write (see the server-side note
            // at the stream handler above).
            stream[bunHTTP2StreamStatus] |= StreamState.StreamResponded;
            if (header_status === 421) {
              // 421 Misdirected Request
              removeOriginFromSet(self, stream);
            }
            if (onClientStreamFinishChannel.hasSubscribers) {
              onClientStreamFinishChannel.publish({ stream, headers, flags });
            }
            if (stream[kPush]) {
              // A pushed stream delivers its response via 'push'; the session 'stream' event already
              // fired (with the promised request headers) when the PUSH_PROMISE arrived.
              stream.emit("push", headers, flags, rawheaders);
            } else {
              // Node's ClientHttp2Session emits 'stream' only for pushed streams; a normal request's
              // response arrives solely via the stream's own 'response' event.
              stream.emit("response", headers, flags, rawheaders);
            }
          }
        }
      },
    ),
    localSettings(self: ClientHttp2Session, settings: Settings) {
      if (!self) return;
      self.#localSettings = settings;
      self.#pendingSettingsAck = false;
      if (self.#pendingSettingsAckCount > 0) self.#pendingSettingsAckCount--;
      // This ACK may be the only thing a gracefully closed, idle session was waiting for.
      if (self.#pendingSettingsAckCount === 0 && self[kSettingsAckGraceTimer] !== undefined) {
        clearTimeout(self[kSettingsAckGraceTimer]);
        self[kSettingsAckGraceTimer] = undefined;
      }
      if (self.#closed && self.#connections === 0 && self.#pendingSettingsAckCount === 0 && !self.destroyed) {
        setImmediate(destroyIfNotDestroyedNT, self);
      }
      const queued = self.#pendingSettingsCallbacks.shift();
      // Node's settingsCallback (lib/internal/http2/core.js) invokes the settings()
      // callback first and emits 'localSettings' after it.
      if (queued != null) queued[0](null, settings, Date.now() - queued[1]);
      self.emit("localSettings", settings);
    },
    remoteSettings(self: ClientHttp2Session, settings: Settings) {
      if (!self) return;
      self.#remoteSettings = settings;
      self.emit("remoteSettings", settings);
      // The peer may have raised maxConcurrentStreams: queued requests might fit now.
      self.#flushPendingRequests();
    },
    ping(self: ClientHttp2Session, payload: Buffer, isACK: boolean) {
      if (!self) return;
      if (!isACK) {
        // node emits 'ping' only for pings initiated by the peer, not for ACKs of our own.
        self.emit("ping", payload);
      }
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
    error(self: ClientHttp2Session, errorCode: number | string, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      // The native parser reports the maxSessionInvalidFrames violation with a string code
      // (it is a JS-level error, not an HTTP/2 error code). A negative numeric code is an
      // nghttp2-style library error for a violation our own engine detected; node surfaces
      // those as NghttpError (code ERR_HTTP2_ERROR) via onSessionInternalError.
      const error_instance =
        errorCode === "ERR_HTTP2_TOO_MANY_INVALID_FRAMES"
          ? $ERR_HTTP2_TOO_MANY_INVALID_FRAMES()
          : typeof errorCode === "number" && errorCode < 0
            ? new NghttpError(errorCode)
            : sessionErrorFromCodeNamed(errorCode as number);
      self.destroy(error_instance);
    },

    wantTrailers: withStreamFrame((self: ClientHttp2Session, stream: ClientHttp2Stream) => {
      if (!self || typeof stream !== "object") return;
      const status = stream[bunHTTP2StreamStatus];
      if ((status & StreamState.WantTrailer) !== 0) return;
      stream[bunHTTP2StreamStatus] = status | StreamState.WantTrailer;
      if (stream.listenerCount("wantTrailers") === 0) {
        self[bunHTTP2Native]?.noTrailers(stream.id);
      } else {
        stream.emit("wantTrailers");
      }
    }),
    goaway(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      if (self.destroyed) return;
      self[kGoawayCode] = errorCode;
      // node: once a GOAWAY is received, new streams cannot be created on this session -
      // request() throws ERR_HTTP2_GOAWAY_SESSION (clients like grpc rely on the throw to
      // fail over to a fresh connection).
      self[kReceivedGoaway] = true;
      self.emit("goaway", errorCode, lastStreamId, opaqueData || Buffer.allocUnsafe(0));
      // node: streams the peer did not process (id above the GOAWAY's lastStreamId) are
      // destroyed with ERR_HTTP2_GOAWAY_SESSION - clients (grpc) rely on that error class to
      // retry on a fresh connection instead of reporting a cancellation.
      self.#parser?.forEachStream(rejectStreamAboveGoawayLastId.bind(null, lastStreamId));
      // Requests still queued behind the concurrency limit never got a stream id; they can never
      // be submitted on this session, so reject them the same way.
      const pendingRequests = self.#pendingRequests;
      self.#pendingRequests = null;
      if (pendingRequests !== null) {
        for (let i = 0; i < pendingRequests.length; i++) {
          streamRejectedByGoawaySession(pendingRequests[i].req);
        }
      }
      // A GOAWAY carrying an error code is a session error: the session and every open stream
      // error with ERR_HTTP2_SESSION_ERROR; like Node, our own goaway goes out with
      // NGHTTP2_NO_ERROR since this side had no error. A graceful GOAWAY (NO_ERROR) begins a
      // shutdown: no new streams permitted, existing streams may finish naturally.
      if (errorCode === constants.NGHTTP2_NO_ERROR) {
        self.close();
      } else if (self.closed && self.#connections === 0) {
        // Mutual teardown: this side already sent its own graceful GOAWAY
        // (close()) and every stream is done, so the peer's error code cannot
        // affect anything user-visible - both ends agreed the connection is
        // over. Destroy cleanly instead of surfacing a session error: node
        // never observes this state (its socket is torn down before the
        // peer's late GOAWAY could be read - grpc-js forceShutdown sends
        // GOAWAY(NGHTTP2_CANCEL) at a client that just close()d, and on the
        // Windows agents the frame deterministically arrived first).
        self.destroy();
      } else {
        self.destroy(sessionErrorFromCode(errorCode), constants.NGHTTP2_NO_ERROR);
      }
    },
    end(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.destroy();
    },
    altsvc(self: ClientHttp2Session, origin: string, value: string, streamId: number) {
      if (!self) return;
      // node.js emits value, origin, streamId
      self.emit("altsvc", value, origin, streamId);
    },
    origin(self: ClientHttp2Session, origin: string | Array<string> | undefined) {
      if (!self) return;
      if (self.encrypted) {
        const originSet = initOriginSet(self);
        if ($isArray(origin)) {
          for (const item of origin) {
            originSet.add(item);
          }
          self.emit("origin", origin);
        } else if (origin) {
          originSet.add(origin);
          self.emit("origin", [origin]);
        }
      }
    },
    write(self: ClientHttp2Session, buffer: Buffer) {
      if (!self) return -1;
      const socket = self[bunHTTP2Socket];
      if (socket && !socket.writableEnded && self.#connected) {
        // redirect writes to socket
        return socket.write(buffer) ? 1 : 0;
      }
      return -1;
    },
  };

  #onRead(data: Buffer) {
    // Inbound traffic refreshes the session's idle timer (node's [kUpdateTimer]).
    if (this[kTimeout]) this[kTimeout].refresh();
    this.#parser?.read(data);
  }

  get originSet() {
    if (this.encrypted) {
      return Array.from(initOriginSet(this));
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
      // client must check alpnProtocol
      if (socket.alpnProtocol !== "h2") {
        socket.end();
        const error = $ERR_HTTP2_ERROR("h2 is not supported");
        this.emit("error", error);
      }
      this.#alpnProtocol = "h2";
    } else {
      this.#alpnProtocol = "h2c";
    }
    const nativeSocket = socket._handle;
    if (nativeSocket) {
      this.#parser.setNativeSocket(nativeSocket);
      this[kDeferWriteCallback] = deferWriteCallbackForSocket(nativeSocket);
    }
    process.nextTick(emitConnectNT, this, socket);
    this.#parser.flush();
    if (this.#closed) {
      // close() was called while the socket was still connecting: requests made in the meantime
      // never reached the peer, so node rejects them with ERR_HTTP2_GOAWAY_SESSION once the
      // connect completes and then lets the session finish closing.
      const pendingRequests = this.#pendingRequests;
      this.#pendingRequests = null;
      if (pendingRequests !== null) {
        for (let i = 0; i < pendingRequests.length; i++) {
          streamRejectedByGoawaySession(pendingRequests[i].req);
        }
      }
      this.#parser?.forEachStream(streamRejectedByGoawaySession);
      this.destroy();
      return;
    }
    // Requests made while the socket was still connecting were queued; submit them now.
    this.#flushPendingRequests();
  }

  #onClose() {
    const parser = this.#parser;
    const err = this.connecting ? $ERR_SOCKET_CLOSED() : null;
    if (parser) {
      parser.forEachStream(streamCancel);
      parser.forEachStream(streamSocketClosed);
      parser.detach();
      this.#parser = null;
    }
    this.destroy(err, NGHTTP2_NO_ERROR);
    this[bunHTTP2Socket] = null;
  }
  #onError(error: Error) {
    // See the client session's #onError: Node's socketOnError is a no-op once
    // the session has been detached from the socket, so a transport error that
    // races our own teardown is not re-reported.
    if (this.destroyed) {
      return;
    }
    this[bunHTTP2Socket] = null;
    if (this.#closed) {
      this.destroy();
      return;
    }
    if (isEconnresetAfterGoaway(this, error)) {
      this.destroy();
      return;
    }
    if (this.listenerCount("error") === 0 && (error as NodeJS.ErrnoException)?.code === "ECONNRESET") {
      // A transport teardown on a session nobody observes (an idle pooled
      // connection dropped by the peer): shut down quietly - the destroy
      // still errors any remaining streams. Anything else (handshake
      // failure, ECONNREFUSED, ...) keeps Node's EventEmitter contract and
      // surfaces when unobserved.
      this.destroy();
      return;
    }
    this.destroy(error);
  }
  #onTimeout() {
    const parser = this.#parser;
    if (parser) {
      parser.forEachStream(emitTimeout);
    }
    this.emit("timeout");
  }
  #onDrain() {
    const parser = this.#parser;
    if (parser) {
      parser.flush();
    }
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
    return this.#closeCalled;
  }

  get remoteSettings() {
    if (this.destroyed || this.connecting) return {};
    return (this.#remoteSettings ??= getDefaultSettings());
  }

  get localSettings() {
    if (this.destroyed || this.connecting) return {};
    return (this.#localSettings ??= getDefaultSettings());
  }

  get pendingSettingsAck() {
    return this.#pendingSettingsAck;
  }

  get type() {
    return 1;
  }
  unref() {
    // Generic-stream sockets (e.g. duplexPair) have no unref; node treats it as a no-op.
    const socket = this[bunHTTP2Socket];
    if (typeof socket?.unref === "function") return socket.unref();
  }
  ref() {
    const socket = this[bunHTTP2Socket];
    if (typeof socket?.ref === "function") return socket.ref();
  }
  setNextStreamID(id) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    validateNumber(id, "id");
    if (id <= 0 || id > kMaxStreams) throw $ERR_OUT_OF_RANGE("id", `> 0 and <= ${kMaxStreams}`, id);
    this.#parser?.setNextStreamID(id);
  }
  setTimeout(msecs, callback) {
    // node's setStreamTimeout: the session owns its own unref'd idle timer under kTimeout
    // (refreshed on inbound frames and writes), it does not arm the socket's timeout.
    return setSessionTimeout.$call(this, msecs, callback);
  }
  ping(payload, callback) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();
    if (typeof payload === "function") {
      callback = payload;
      payload = undefined;
    }
    if (payload) {
      validateBuffer(payload, "payload");
      if (payload.byteLength !== 8) throw $ERR_HTTP2_PING_LENGTH();
    }
    validateFunction(callback, "callback");

    const cb = makeHttp2Ping(callback);
    const parser = this.#parser;
    if (!parser || !this[bunHTTP2Socket]) {
      process.nextTick(cb, $ERR_HTTP2_PING_CANCEL(), 0, payload);
      return false;
    }
    if (parser.ping(payload || kEmptyPingPayload) === false) {
      process.nextTick(cb, $ERR_HTTP2_PING_CANCEL(), 0, payload);
      return false;
    }
    if (this.#pingCallbacks) {
      this.#pingCallbacks.push([cb, Date.now()]);
    } else {
      this.#pingCallbacks = [[cb, Date.now()]];
    }
    return true;
  }
  goaway(errorCode = constants.NGHTTP2_NO_ERROR, lastStreamId = 0, opaqueData) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();
    return this.#parser?.goaway(errorCode, lastStreamId, opaqueData);
  }

  setLocalWindowSize(windowSize) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    validateWindowSize(windowSize);
    return this.#parser?.setLocalWindowSize?.(windowSize);
  }
  get socket() {
    if (this.#socket_proxy) return this.#socket_proxy;
    const socket = this[bunHTTP2Socket];
    if (!socket) return null;
    this.#socket_proxy = new Proxy(this, proxySocketHandler);
    return this.#socket_proxy;
  }
  get state() {
    return this.#parser?.getCurrentState();
  }

  settings(settings: Settings, callback?) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();
    if (callback !== undefined && typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    // node treats an omitted/undefined settings object as an empty update.
    if (settings === undefined) settings = {} as Settings;
    validateSettings(settings);
    // node: when more SETTINGS are submitted than maxOutstandingSettings allows un-ACKed, the
    // session is destroyed with ERR_HTTP2_MAX_PENDING_SETTINGS_ACK (surfaced via 'error').
    this.#pendingSettingsAckCount++;
    if (this.#pendingSettingsAckCount > this.#maxOutstandingSettings) {
      this.destroy($ERR_HTTP2_MAX_PENDING_SETTINGS_ACK(), constants.NGHTTP2_INTERNAL_ERROR);
      return;
    }
    this.#pendingSettingsAck = true;
    this.#parser?.settings(settings);
    // The frame is queued on the native session; flush it now (as close() does for its
    // GOAWAY) instead of waiting for the next unrelated write. Node schedules a session
    // write for every settings() call, so its SETTINGS goes out with the current batch -
    // a late frame here means the ACK trails the peer's response and a session closed at
    // that response's end never resolves the settings callback.
    this.#parser?.flush?.();
    // Queue the callback so this call's own ACK invokes it (after 'localSettings');
    // the null seed absorbs the initial-preface ACK that has no user callback.
    this.#pendingSettingsCallbacks.push(typeof callback === "function" ? [callback, Date.now()] : null);
  }

  constructor(url: string | URL, options?: Http2ConnectOptions, listener?: Function) {
    super();

    if (typeof options === "function") {
      listener = options;
      options = undefined;
    }

    assertIsObject(options, "options");
    options = { ...options };

    assertIsArray(options.remoteCustomSettings, "options.remoteCustomSettings");
    if (options.remoteCustomSettings) {
      options.remoteCustomSettings = [...options.remoteCustomSettings];
      if (options.remoteCustomSettings.length > MAX_ADDITIONAL_SETTINGS) throw $ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS();
    }

    if (typeof url === "string") url = new URL(url);

    assertIsObject(url, "authority", ["string", "Object", "URL"]);

    if (options.maxReservedRemoteStreams !== undefined) {
      this.#maxReservedRemoteStreams = options.maxReservedRemoteStreams;
    }
    if (options.strictFieldWhitespaceValidation === false) {
      this.#strictFieldWhitespaceValidation = false;
    }
    this[kStrictSingleValueFields] = options.strictSingleValueFields !== false;
    this.#url = url;

    const protocol = url.protocol || options?.protocol || "https:";
    switch (protocol) {
      case "http:":
      case "https:":
        break;
      default:
        throw $ERR_HTTP2_UNSUPPORTED_PROTOCOL(protocol);
    }
    const port = url.port ? parseInt(url.port, 10) : protocol === "http:" ? 80 : 443;

    let host = "localhost";
    if (url.hostname) {
      host = url.hostname;
      if (host[0] === "[") host = host.slice(1, -1);
    } else if (url.host) {
      host = url.host;
    }

    // Store computed authority like Node.js does (session[kAuthority] = `${host}:${port}`).
    // node derives the default authority from the TLS servername when one is configured (the
    // SNI the client presents), falling back to the URL host. Only the *authority* uses the
    // servername - the connection itself still goes to the URL host.
    const authorityHost =
      typeof options?.servername === "string" && options.servername !== "" ? options.servername : host;
    // node always includes the port: session[kAuthority] = `${servername || host}:${port}`.
    {
      // IPv6 literals need brackets when appending the port (e.g., [::1]:8080)
      const needsBrackets =
        StringPrototypeIncludes.$call(authorityHost, ":") && !StringPrototypeStartsWith.$call(authorityHost, "[");
      this.#authority = needsBrackets ? `[${authorityHost}]:${port}` : `${authorityHost}:${port}`;
    }

    function onConnect() {
      try {
        this.#onConnect(arguments);
        listener?.$call(this, this);
      } catch (e) {
        this.destroy(e);
      }
    }

    // h2 with ALPNProtocols
    let socket;
    if (typeof options?.maxOutstandingSettings === "number" && options.maxOutstandingSettings >= 1) {
      this.#maxOutstandingSettings = options.maxOutstandingSettings;
    }
    if (typeof options?.createConnection === "function") {
      socket = options.createConnection(url, options);
      this[bunHTTP2Socket] = socket;

      if (socket.connecting || socket.secureConnecting) {
        const connectEvent = socket instanceof tls.TLSSocket ? "secureConnect" : "connect";
        socket.once(connectEvent, onConnect.bind(this));
      } else {
        process.nextTick(onConnect.bind(this));
      }
    } else {
      socket = connectWithProtocol(
        protocol,
        options
          ? {
              host,
              port: String(port),
              ALPNProtocols: ["h2"],
              ...options,
            }
          : {
              host,
              port: String(port),
              ALPNProtocols: ["h2"],
            },
        onConnect.bind(this),
      );
      this[bunHTTP2Socket] = socket;
    }
    this.#encrypted = socket instanceof TLSSocket;
    const nativeSocket = socket._handle;
    this[kDeferWriteCallback] = deferWriteCallbackForSocket(nativeSocket);

    if (options?.settings !== undefined) {
      validateSettings(options.settings);
    }
    const nativeSettings = { ...options, ...options?.settings };
    this.#localSettings = initialLocalSettings(nativeSettings);
    this.#parser = new H2FrameParser({
      native: nativeSocket,
      context: this,
      settings: nativeSettings,
      handlers: ClientHttp2Session.#Handlers,
    });
    socket.on("data", this.#onRead.bind(this));
    socket.on("drain", this.#onDrain.bind(this));
    socket.on("close", this.#onClose.bind(this));
    socket.on("error", this.#onError.bind(this));
    socket.on("timeout", this.#onTimeout.bind(this));
  }

  // Gracefully closes the Http2Session, allowing any existing streams to complete on their own and preventing new Http2Stream instances from being created. Once closed, http2session.destroy() might be called if there are no open Http2Stream instances.
  // If specified, the callback function is registered as a handler for the 'close' event.
  close(callback: Function) {
    if (this.#closed || this.destroyed) return;
    this.#closed = true;
    this.#closeCalled = true;

    if (typeof callback === "function") {
      this.once("close", callback);
    }
    // node submits a graceful GOAWAY as soon as close() is called; the peer observes the shutdown
    // ('goaway' event) while in-flight streams are still allowed to finish. The session is only
    // destroyed once there is nothing in flight, and never before the GOAWAY had a chance to leave.
    this.goaway(constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
    this[kGoawaySent] = true;
    this.#parser?.flush?.();
    // Requests queued while the socket is still connecting count as in-flight too: they are
    // rejected with ERR_HTTP2_GOAWAY_SESSION from #onConnect (node's requestOnConnect), not
    // canceled by an early destroy.
    //
    // A settings() whose ACK has not arrived also keeps the graceful close from destroying
    // the session yet: node always observes that ACK before it gets here because it batches
    // the SETTINGS frame into the same write as the request (so the ACK beats the response),
    // and the vendored tests close() from the response's 'end' relying on it. The wait is
    // bounded: an ACK is mandatory (RFC 9113 6.5.3) and arrives one round-trip later; the
    // localSettings dispatch finishes the deferred destroy, and a dead socket still tears
    // the session down. destroy() remains immediate.
    if (this.#connections === 0 && (this.#pendingRequests === null || this.#pendingRequests.length === 0)) {
      if (this.#pendingSettingsAckCount > 0) scheduleSettingsAckGraceNT(this);
      else setImmediate(destroyIfNotDestroyedNT, this);
    }
  }

  destroy(error?: Error | number, code?: number) {
    // Node's destroy() is idempotent - "if (this.destroyed) return;" is its
    // first line - so a second destroy (e.g. the received-GOAWAY handler
    // destroying with a session error after a socket error's destroy already
    // ran re-entrantly out of the 'goaway' emit) never re-runs the teardown or
    // re-emits 'error' on a session whose one-shot listeners are consumed.
    // Guard on a latch, not the destroyed getter: that getter reads "socket
    // detached", which #onError sets before calling in here, and the
    // error-carrying destroy must still run once.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js (Http2Session#destroy)
    if (this.#destroying) {
      return;
    }
    const socket = this[bunHTTP2Socket];
    if (this.#closed && !this.#connected && !this.#parser) {
      // Nothing left to tear down. Do NOT latch here: latching on this
      // early-out left the session permanently un-destroyable when a
      // redundant destroy() ran first (zombie sessions on the darwin agents:
      // half-torn sockets surfacing ECONNRESET, writes into closed handles).
      return;
    }
    this.#destroying = true;
    try {
      if (this[kTimeout]) {
        clearTimeout(this[kTimeout]);
        this[kTimeout] = null;
      }
      cancelPendingPings(this.#pingCallbacks);
      this.#pingCallbacks = null;
      if (typeof error === "number") {
        code = error;
        error = code !== constants.NGHTTP2_NO_ERROR ? $ERR_HTTP2_SESSION_ERROR(code) : undefined;
      }
      if (code === undefined && error != null) {
        code = constants.NGHTTP2_INTERNAL_ERROR;
      }
      if (error) {
        // Streams torn down by this destroy surface the same session error (node semantics).
        this[kSessionDestroyError] = error;
      }
      this.#closed = true;
      this.#connected = false;
      {
        // Requests still queued (waiting for connect or for a concurrency slot) never reached the
        // wire; node cancels them with ERR_HTTP2_STREAM_CANCEL (carrying the session error, if any,
        // as its cause).
        const pendingRequests = this.#pendingRequests;
        this.#pendingRequests = null;
        if (pendingRequests !== null && pendingRequests.length > 0) {
          const cancelError = createPendingStreamCancelError(error);
          for (let i = 0; i < pendingRequests.length; i++) {
            const req = pendingRequests[i].req;
            if (!req.destroyed) {
              req.rstCode = code !== undefined ? code : constants.NGHTTP2_CANCEL;
              req.destroy(cancelError);
            }
          }
        }
      }
      if (socket) {
        if (!this[kGoawaySent] || code) {
          // close() already announced a graceful shutdown - re-sending NO_ERROR would be redundant
          // and double-fires the peer's 'goaway' event. An error code is new information, though:
          // a destroy(err) after close() must still put the error GOAWAY on the wire.
          this.goaway(code || constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
        }
        if (error) {
          // See the client session: end first, destroy a tick later (node's
          // finishSessionClose Windows-ECONNRESET avoidance).
          endThenDestroySessionSocket(socket, error);
        } else {
          // See the client session's destroy: Node's finishSessionClose resumes
          // the socket on a graceful close so unread inbound bytes cannot turn
          // the FIN teardown into an RST.
          // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1188
          socket.resume();
          socket.end();
        }
      }
      const parser = this.#parser;
      if (parser) {
        // node cancels streams still open when their session is destroyed: each gets
        // ERR_HTTP2_STREAM_CANCEL (or the session error when one was provided), with the CANCEL
        // rst code.
        if (this[kSessionDestroyError] == null && error == null) {
          this[kSessionDestroyError] = createPendingStreamCancelError();
        }
        // Like Node's Http2Stream._destroy: a received GOAWAY's code takes
        // precedence over the destroy code when streams are torn down.
        this[bunHTTP2SessionTeardownFrame] = $getInternalField($asyncContext, 0);
        try {
          parser.emitErrorToAllStreams(this[kGoawayCode] || (code !== undefined ? code : constants.NGHTTP2_CANCEL));
        } finally {
          this[bunHTTP2SessionTeardownFrame] = kNoSessionTeardown;
        }
        parser.detach();
      }
    } catch (e) {
      // A throwing destroy did not destroy: argument validation (goaway's
      // validateInteger, the native session rejecting a non-numeric error
      // code) throws mid-teardown, and a corrected retry must still run.
      this.#destroying = false;
      throw e;
    }
    this.#parser = null;
    this[bunHTTP2Socket] = null;

    // Read-and-clear the frame first: emitting 'error' with no listener throws,
    // which would skip the clear and leave a retained session pinning the store.
    const asyncFrame = this[bunHTTP2AsyncContextFrame];
    this[bunHTTP2AsyncContextFrame] = undefined;
    if (error) {
      runInFrame(asyncFrame, this.emit, this, "error", error);
    }
    // node emits the session 'close' event asynchronously (a listener attached right after
    // close()/destroy() returns must still observe it).
    process.nextTick(emitSessionCloseNT, this, asyncFrame);
  }

  request(headers: any, options?: any) {
    // Set once a stream id was allocated (streamStart incremented #connections); validation
    // throws before that point must not decrement.
    let connectionsCounted = false;
    try {
      // node validates arguments synchronously and only defers session-state failures
      // (destroyed/closed/GOAWAY) to the returned stream, so bad options throw even on
      // a destroyed session (lib/internal/http2/core.js request()).
      if (options !== undefined) {
        if (options.endStream !== undefined) validateBoolean(options.endStream, "options.endStream");
        if (options.parent !== undefined) validateNumber(options.parent, "options.parent");
        if (options.exclusive !== undefined) validateBoolean(options.exclusive, "options.exclusive");
        if (options.silent !== undefined) validateBoolean(options.silent, "options.silent");
      }
      if (this.destroyed) {
        const req = new ClientHttp2Stream(undefined, this, headers);
        process.nextTick(destroyWithInvalidSessionNT, req);
        return req;
      }
      if (this[kReceivedGoaway]) {
        const err = new Error("New streams cannot be created after receiving a GOAWAY");
        err.code = "ERR_HTTP2_GOAWAY_SESSION";
        throw err;
      }
      if (this.closed) {
        // node: a closed (close() called / GOAWAY pending) session reports
        // ERR_HTTP2_GOAWAY_SESSION on the stream (verified node v26.3.0); the test
        // contract accepts a synchronous throw of the same error.
        const err = new Error("New streams cannot be created after receiving a GOAWAY");
        err.code = "ERR_HTTP2_GOAWAY_SESSION";
        throw err;
      }

      if (this.sentTrailers) {
        throw $ERR_HTTP2_TRAILERS_ALREADY_SENT();
      }

      // Raw (flat [name, value, ...] array) headers form: missing pseudo-header
      // defaults are prepended and the pairs are encoded on the wire in their
      // given order. The derived object form (original-case keys, array values
      // for duplicates) backs sentHeaders.
      let rawHeadersList: any[] | null = null;
      if (headers == undefined) {
        headers = {};
      } else if ($isArray(headers)) {
        const raw = headers;
        let method, scheme, authority, path, protocol;
        for (let i = 0; i < raw.length; i += 2) {
          const key = raw[i];
          if (typeof key !== "string" || key.charCodeAt(0) !== 0x3a /* ':' */) continue;
          const lowered = key.toLowerCase();
          const value = raw[i + 1];
          if (lowered === HTTP2_HEADER_METHOD) method = value;
          else if (lowered === HTTP2_HEADER_SCHEME) scheme = value;
          else if (lowered === HTTP2_HEADER_AUTHORITY) authority = value;
          else if (lowered === HTTP2_HEADER_PATH) path = value;
          else if (lowered === HTTP2_HEADER_PROTOCOL) protocol = value;
        }
        const additionalPseudoHeaders: any[] = [];
        if (method === undefined) {
          method = HTTP2_METHOD_GET;
          additionalPseudoHeaders.push(HTTP2_HEADER_METHOD, method);
        }
        if (method !== HTTP2_METHOD_CONNECT || protocol !== undefined) {
          // `raw` is a flat [name, value, ...] array - scan the name slots for a host header
          // instead of reading a string key off the array.
          let rawHasHost = false;
          for (let i = 0; i < raw.length; i += 2) {
            if (typeof raw[i] === "string" && raw[i].toLowerCase() === HTTP2_HEADER_HOST) {
              rawHasHost = true;
              break;
            }
          }
          if (authority === undefined && !rawHasHost) {
            authority = this.#authority;
            additionalPseudoHeaders.push(HTTP2_HEADER_AUTHORITY, authority);
          }
          if (scheme === undefined) {
            const urlProtocol: string = this.#url?.protocol || options?.protocol || "https:";
            scheme = urlProtocol === "http:" ? "http" : urlProtocol === "https:" ? "https" : urlProtocol;
            additionalPseudoHeaders.push(HTTP2_HEADER_SCHEME, scheme);
          }
          if (path === undefined) {
            additionalPseudoHeaders.push(HTTP2_HEADER_PATH, "/");
          }
        } else {
          if (authority === undefined) throw $ERR_HTTP2_CONNECT_AUTHORITY();
          if (scheme !== undefined) throw $ERR_HTTP2_CONNECT_SCHEME();
          if (path !== undefined) throw $ERR_HTTP2_CONNECT_PATH();
        }
        rawHeadersList = additionalPseudoHeaders.length ? additionalPseudoHeaders.concat(raw) : raw;
        const headersObject = { __proto__: null };
        for (let i = 0; i < rawHeadersList.length; i += 2) {
          const key = rawHeadersList[i];
          const value = rawHeadersList[i + 1];
          const existing = headersObject[key];
          if (existing === undefined) headersObject[key] = value;
          else if ($isArray(existing)) existing.push(value);
          else headersObject[key] = [existing, value];
        }
        if (raw[sensitiveHeaders] !== undefined) {
          headersObject[sensitiveHeaders] = raw[sensitiveHeaders];
        }
        headers = headersObject;
      } else if (!$isObject(headers)) {
        throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
      } else {
        headers = { ...headers };
      }

      // Copy options so user-supplied getters run now, before the header block
      // is encoded — a getter that re-entrantly calls request() would otherwise
      // reorder header blocks on the wire (Node does the same).
      if ($isObject(options)) {
        options = { ...options };
      }

      if ($isObject(options) && "weight" in options) {
        // RFC 9113 deprecated priority signalling: node emits DEP0194 when the option is present
        // and ignores it (the request always goes out with the default weight).
        if (!priorityWeightDeprecationWarned) {
          priorityWeightDeprecationWarned = true;
          process.emitWarning(
            "Priority signaling has been deprecated as of RFC 9113.",
            "DeprecationWarning",
            "DEP0194",
          );
        }
        delete options.weight;
      }

      const sensitives = headers[sensitiveHeaders];
      // Note: the sensitiveHeaders symbol stays on the object — the native header walk skips
      // symbol keys, and deleting it here would flip the object into dictionary mode,
      // pessimizing every later property access on it.
      if (sensitives !== undefined && !$isArray(sensitives)) {
        throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
      }
      const sensitiveNames = buildSensitiveNames(headers, sensitives);
      // Validate header names in JS like node's buildNgHeaderString does: request() must throw
      // synchronously for an invalid name even while the session is still connecting (the native
      // encoder only sees the headers once a queued request is actually submitted). Empty names
      // keep going to the native validator, matching its acceptance.
      {
        const headerNames = ObjectKeys(headers);
        for (let i = 0; i < headerNames.length; i++) {
          const name = headerNames[i];
          if (name === "") continue;
          if (name.charCodeAt(0) === 0x3a /* ':' */) {
            // Unknown pseudo-header names throw synchronously (node's mapToHeaders); known ones
            // are still re-checked by the native encoder at submission time.
            assertValidPseudoHeader(name);
            continue;
          }
          if (!checkIsHttpToken(name)) {
            throw $ERR_INVALID_HTTP_TOKEN("Header name", name);
          }
        }
      }
      // Validate single-value constraints before anything is encoded (a mid-encode throw would
      // desync the shared HPACK table from the peer).
      if (this[kStrictSingleValueFields] !== false) assertSingleValueHeaders(headers);
      // node keeps the never-index list visible on the request's sentHeaders (symbol keys are
      // not iterated by the wire-encoding path, so re-attaching is safe).
      if (sensitives !== undefined) headers[sensitiveHeaders] = sensitives;
      const url = this.#url;

      // RFC 9113 §8.5: CONNECT must carry an explicit :authority and no :scheme/:path — validated
      // before any defaults are applied.
      if (headers[":method"] === HTTP2_METHOD_CONNECT && headers[":protocol"] === undefined) {
        if (!headers[":authority"]) {
          throw $ERR_HTTP2_CONNECT_AUTHORITY();
        }
        if (headers[":scheme"] !== undefined) {
          throw $ERR_HTTP2_CONNECT_SCHEME();
        }
        if (headers[":path"] !== undefined) {
          throw $ERR_HTTP2_CONNECT_PATH();
        }
      }

      // node injects defaulted pseudo-headers in this order: :method, :authority, :scheme,
      // :path - the object's insertion order is the wire order.
      let method = headers[":method"];
      if (!method) {
        method = "GET";
        headers[":method"] = method;
      }
      let authority = headers[":authority"];
      if (!authority) {
        // Use precomputed authority (like Node.js's session[kAuthority])
        authority = this.#authority;
        if (!headers["host"]) {
          headers[":authority"] = authority;
        }
      }

      if (method !== HTTP2_METHOD_CONNECT || headers[":protocol"] !== undefined) {
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

        if (headers[":path"] == undefined) {
          headers[":path"] = "/";
        }
      }

      let rejectContentLengthOnNoPayload = false;
      if (NoPayloadMethods.has(method.toUpperCase())) {
        // Like Node, a payload-meaningless method only defaults endStream to
        // true when the caller expressed no preference; an explicit endStream
        // (validated above) is honored, so { endStream: false } stays open.
        if (!options || !$isObject(options)) {
          options = { endStream: true };
        } else if (options.endStream === undefined) {
          options = { ...options, endStream: true };
        }
        // nghttp2 refuses content-length on a request whose HEADERS carry END_STREAM (no payload
        // can follow): reset with PROTOCOL_ERROR after creation (an async stream error, not a
        // throw). An explicit endStream:false keeps the body legal, so only the ended case rejects.
        if (options.endStream) {
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === "content-length") {
              rejectContentLengthOnNoPayload = true;
              break;
            }
          }
        }
      }

      {
        // nghttp2 rejects :path values containing control characters, SP or DEL at send time and
        // surfaces it as a stream error rather than a synchronous throw; mirror that. Validate
        // before a stream id is allocated AND before the concurrency queue, so queued requests are
        // validated exactly like immediate ones.
        const path = headers[":path"];
        if (typeof path === "string") {
          for (let i = 0; i < path.length; i++) {
            const c = path.charCodeAt(i);
            if (c <= 0x20 || c === 0x7f) {
              const req = new ClientHttp2Stream(undefined, this, headers);
              req.authority = authority;
              req[kHeadRequest] = method === HTTP2_METHOD_HEAD;
              req.rstCode = constants.NGHTTP2_PROTOCOL_ERROR;
              process.nextTick(emitStreamErrorNT, this, req, constants.NGHTTP2_PROTOCOL_ERROR, true, false);
              process.nextTick(emitEventNT, req, "ready");
              return req;
            }
          }
        }
      }

      if (rejectContentLengthOnNoPayload) {
        // Reject before a stream id is allocated and before the concurrency queue, so queued
        // requests are validated exactly like immediate ones. No native stream state means no
        // late native callbacks; node surfaces this as a stream error with no 'end' event.
        const req = new ClientHttp2Stream(undefined, this, headers);
        req.authority = authority;
        req[kHeadRequest] = method === HTTP2_METHOD_HEAD;
        process.nextTick(rejectNoPayloadContentLengthNT, req);
        process.nextTick(emitEventNT, req, "ready");
        return req;
      }

      // Like Node, a request whose signal is already aborted never touches the
      // wire: the stream is created without an id and destroyed synchronously
      // with an AbortError (_destroy skips the RST for id-less streams).
      // Sending an RST for a stream the peer never saw is a connection error
      // that makes conforming servers reply with GOAWAY.
      let signal;
      if ($isObject(options) && options.signal) {
        // Node validates the signal before reading .aborted: any object with an
        // 'aborted' property passes (so a duck-typed { aborted: true } takes
        // the abort fast path), while objects without one and non-objects
        // throw ERR_INVALID_ARG_TYPE synchronously.
        signal = options.signal;
        validateAbortSignal(signal, "options.signal");
        if (signal.aborted) {
          const req = new ClientHttp2Stream(undefined, this, headers);
          // The writable side is ended first (endStream requests), so the stream is destroyed
          // without counting as aborted — only the AbortError is reported.
          if (options.endStream) req.end();
          req.destroy($makeAbortError(undefined, { cause: signal.reason }));
          return req;
        }
      }

      // A request made before the socket finished connecting, or while the peer's
      // SETTINGS_MAX_CONCURRENT_STREAMS limit leaves no slot, is not submitted yet — node returns
      // a "pending" stream (no id) and sends its HEADERS frame once the session connects / a slot
      // frees, keeping stream id allocation in submission order. Deferring until connect is what
      // lets a stream destroyed before connect never reach the wire.
      const maxConcurrentStreams = this.#remoteSettings?.maxConcurrentStreams;
      if (
        !this.#connected ||
        (this.#pendingRequests !== null && this.#pendingRequests.length > 0) ||
        (typeof maxConcurrentStreams === "number" && this.#activeRequestCount >= maxConcurrentStreams)
      ) {
        const req = new ClientHttp2Stream(undefined, this, headers);
        req.authority = authority;
        req[kHeadRequest] = method === HTTP2_METHOD_HEAD;
        if (onClientStreamCreatedChannel.hasSubscribers) {
          onClientStreamCreatedChannel.publish({ stream: req, headers });
        }
        if (this.#pendingRequests === null) {
          this.#pendingRequests = [];
        }
        // Preserve both forms: the on-wire (array) form keeps duplicate-header interleaving the
        // object form cannot represent; the object form is what diagnostics channels publish.
        this.#pendingRequests.push({
          req,
          headers,
          wireHeaders: rawHeadersList !== null ? rawHeadersList : headers,
          sensitiveNames,
          options,
        });
        // node corks every Http2Stream until its native handle is assigned; same here so
        // synchronous writes after a queued request() batch through _writev once the slot frees.
        req.cork();
        process.nextTick(uncorkNT, req);
        setupRequestEndAndSignal(req, options, signal);
        return req;
      }

      connectionsCounted = true;
      let stream_id: number = this.#parser.getNextStream();
      if (stream_id < 0) {
        const req = new ClientHttp2Stream(undefined, this, headers);
        process.nextTick(emitOutofStreamErrorNT, req);
        return req;
      }
      const req = new ClientHttp2Stream(stream_id, this, headers);
      req.authority = authority;
      req[kHeadRequest] = method === HTTP2_METHOD_HEAD;
      if (onClientStreamCreatedChannel.hasSubscribers) {
        onClientStreamCreatedChannel.publish({ stream: req, headers });
      }
      const wireHeaders = rawHeadersList !== null ? rawHeadersList : headers;
      if (typeof options === "undefined") {
        this.#parser.request(stream_id, req, wireHeaders, sensitiveNames);
      } else {
        this.#parser.request(stream_id, req, wireHeaders, sensitiveNames, options);
      }
      if (onClientStreamStartChannel.hasSubscribers) {
        onClientStreamStartChannel.publish({ stream: req, headers });
      }
      this.#trackActiveRequest(req);
      // node corks every Http2Stream until its native handle is assigned (always at least one tick
      // after request() returns), so body chunks written synchronously after request() are buffered
      // and flushed together through _writev.
      req.cork();
      process.nextTick(uncorkNT, req);
      setupRequestEndAndSignal(req, options, signal);
      process.nextTick(emitEventNT, req, "ready");
      return req;
    } catch (e: any) {
      if (connectionsCounted) {
        this.#connections--;
        process.nextTick(emitErrorNT, this, e, this.#connections === 0 && this.#closed);
      }
      throw e;
    }
  }

  // Counts a submitted request against the peer's SETTINGS_MAX_CONCURRENT_STREAMS limit until its
  // stream closes, then tries to submit queued requests.
  #trackActiveRequest(req: ClientHttp2Stream) {
    this.#activeRequestCount++;
    req.once("close", () => {
      this.#activeRequestCount--;
      this.#flushPendingRequests();
    });
  }

  // Submits requests queued behind the peer's SETTINGS_MAX_CONCURRENT_STREAMS limit while slots
  // are available, in the order they were made.
  #flushPendingRequests() {
    const queue = this.#pendingRequests;
    if (queue === null || queue.length === 0) return;
    while (queue.length > 0) {
      const parser = this.#parser;
      if (this.destroyed || !parser) {
        // The session is gone: queued requests never reached the wire, cancel them.
        const { req } = queue.shift();
        if (!req.destroyed) {
          req.rstCode = constants.NGHTTP2_CANCEL;
          req.destroy();
        }
        continue;
      }
      const maxConcurrentStreams = this.#remoteSettings?.maxConcurrentStreams;
      if (typeof maxConcurrentStreams === "number" && this.#activeRequestCount >= maxConcurrentStreams) {
        break;
      }
      const { req, headers, wireHeaders, sensitiveNames, options } = queue.shift();
      // A pending stream that was close()d (but not destroyed) is still submitted: node sends its
      // HEADERS and follows up with the RST_STREAM once the id is known (see close()).
      if (req.destroyed) continue;
      const stream_id: number = parser.getNextStream();
      if (stream_id < 0) {
        process.nextTick(emitOutofStreamErrorNT, req);
        continue;
      }
      req[kSetStreamId](stream_id);
      try {
        if (typeof options === "undefined") {
          parser.request(stream_id, req, wireHeaders, sensitiveNames);
        } else {
          parser.request(stream_id, req, wireHeaders, sensitiveNames, options);
        }
      } catch (err) {
        // Native request() can reject headers the pre-queue validation does not cover (invalid
        // tokens, bad value bytes); fail this queued request like the immediate path and keep
        // flushing the rest. The native context was never attached, so the reset dispatch cannot
        // release the connection slot - do it here, like the immediate path's catch. The HEADERS
        // never reached the wire either, so the teardown must not write RST_STREAM for an id the
        // peer considers idle.
        this.#connections--;
        req[kNeverAnnounced] = true;
        if (!req.destroyed) req.destroy(err);
        continue;
      }
      if (onClientStreamStartChannel.hasSubscribers) {
        onClientStreamStartChannel.publish({ stream: req, headers });
      }
      this.#trackActiveRequest(req);
      process.nextTick(emitEventNT, req, "ready");
    }
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

function setupCompat(ev) {
  if (ev === "request") {
    this.removeListener("newListener", setupCompat);
    const options = this[bunSocketServerOptions];
    const ServerRequest = options?.Http2ServerRequest || Http2ServerRequest;
    const ServerResponse = options?.Http2ServerResponse || Http2ServerResponse;
    this.on("stream", FunctionPrototypeBind.$call(onServerStream, this, ServerRequest, ServerResponse));
  }
}

function sessionOnError(error) {
  this[kServer]?.emit("sessionError", error, this);
}
function sessionOnTimeout() {
  if (this.destroyed || this.closed) return;
  const server = this[kServer];
  if (!server.emit("timeout", this)) {
    this.destroy();
  }
}
/**
 * This function closes all active sessions gracefully.
 * @param {*} server the underlying server whose sessions to be closed
 */
function closeAllSessions(server: Http2Server | Http2SecureServer) {
  const sessions = server[kSessions];
  if (sessions.size > 0) {
    for (const session of sessions) {
      session.close();
    }
  }
}

// Minimal HTTP/1.1 response writer used by the allowHTTP1 fallback. It mimics
// the surface of the native NodeHTTPResponse handle that ServerResponse drives
// (cork/writeHead/write/end/abort/...), serializing directly onto the TLS socket.
function createHttp1FallbackResponseHandle(socket, shouldKeepAlive, keepAliveTimeout) {
  const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
  let head = null;
  let headWritten = false;
  let chunked = false;
  let noBody = false;
  let closeDelimited = false;

  function writeHeadToSocket(contentLength) {
    if (headWritten) return;
    headWritten = true;
    const statusCode = head?.statusCode ?? 200;
    let statusMessage = head?.statusMessage;
    if (typeof statusMessage !== "string" || statusMessage === "") {
      statusMessage = STATUS_CODES[statusCode] || "unknown";
    }
    let out = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
    let hasContentLength = false;
    let hasTransferEncoding = false;
    let hasDate = false;
    let hasConnection = false;
    let hasKeepAlive = false;
    const headers = head?.headers;
    if (headers) {
      // ServerResponse drives this handle with renderNativeHeaders(): a flat
      // [name, value, name, value, ...] array with original-case names.
      for (let i = 0, end = headers.length - 1; i < end; i += 2) {
        const name = headers[i];
        const value = headers[i + 1];
        if (name.length === 1 && name.charCodeAt(0) === 0) {
          // node:http's NUL-named framing sentinel pair (see NodeHTTP.cpp):
          // value "2" = no body (HEAD), anything else = close-delimited.
          if (value === "2") noBody = true;
          else closeDelimited = true;
          continue;
        }
        switch (name.toLowerCase()) {
          case "content-length":
            hasContentLength = true;
            break;
          case "transfer-encoding":
            hasTransferEncoding = true;
            if (String(value).toLowerCase().includes("chunked")) chunked = true;
            break;
          case "date":
            hasDate = true;
            break;
          case "connection":
            hasConnection = true;
            break;
          case "keep-alive":
            hasKeepAlive = true;
            break;
        }
        out += `${name}: ${value}\r\n`;
      }
    }
    if (!hasContentLength && !hasTransferEncoding && !noBody && !closeDelimited) {
      if (contentLength === null) {
        chunked = true;
        out += "Transfer-Encoding: chunked\r\n";
      } else {
        out += `Content-Length: ${contentLength}\r\n`;
      }
    }
    if (!hasDate) {
      out += `Date: ${new Date().toUTCString()}\r\n`;
    }
    // renderNativeHeaders reports its Connection decision through the
    // auto-header bits (AUTO_HEADER_* in _http_server.ts / kAutoHeader* in
    // NodeHTTP.cpp); honor an explicit close (res.shouldKeepAlive = false,
    // the graceful-shutdown pattern) over the parser-derived flag.
    // A close-delimited response still advertises the close it performs: only
    // the keep-alive line is suppressed, since the connection ends with the
    // body. When the user removed the Connection header (_removedConnection),
    // renderNativeHeaders sets neither bit, so nothing is written here.
    const autoBits = head?.autoHeaderBits ?? 0;
    if (!hasConnection) {
      if ((autoBits & 4) !== 0) {
        out += "Connection: close\r\n";
      } else if (!closeDelimited) {
        // No close bit and no Connection pair on a close-delimited response means
        // the user removed the header (Node's _removedConnection) — write none
        // rather than inventing keep-alive on a connection that ends with the
        // body. Every other response still advertises its connection state.
        if (shouldKeepAlive) {
          out += "Connection: keep-alive\r\n";
          // A user-sent Keep-Alive header (already written by the loop above)
          // suppresses the auto line, like the native writeAutoHeaders. The
          // bit-carried timeout wins when present; otherwise fall back to this
          // handle's configured timeout, preserving pre-bits behavior.
          if (!hasKeepAlive) {
            const kaSecs =
              (autoBits & 8) !== 0 ? head.keepAliveTimeoutSecs : Math.floor((keepAliveTimeout || 5000) / 1000);
            out += `Keep-Alive: timeout=${kaSecs}\r\n`;
          }
        } else {
          out += "Connection: close\r\n";
        }
      }
    }
    out += "\r\n";
    socket.write(out);
  }

  function toBuffer(chunk, encoding) {
    if (chunk == null) return null;
    if (typeof chunk === "string") return Buffer.from(chunk, encoding || "utf8");
    return chunk;
  }

  function writeBody(buf) {
    const length = buf ? (buf.byteLength ?? buf.length) : 0;
    if (length) {
      if (chunked) {
        socket.write(length.toString(16) + "\r\n");
        socket.write(buf);
        socket.write("\r\n");
      } else {
        socket.write(buf);
      }
    }
    return length;
  }

  const handle = {
    flags: 0,
    ended: false,
    finished: false,
    aborted: false,
    bufferedAmount: 0,
    shouldKeepAlive,
    onfinished: null,
    cork(callback) {
      return callback();
    },
    writeHead(statusCode, statusMessage, headers, autoHeaderBits, keepAliveTimeoutSecs) {
      const originalStatusCode = statusCode;
      statusCode |= 0;
      if (statusCode < 100 || statusCode > 999) {
        throw $ERR_HTTP_INVALID_STATUS_CODE(`${originalStatusCode}`);
      }
      if (typeof statusMessage === "string" && checkInvalidHeaderChar(statusMessage)) {
        throw $ERR_INVALID_CHAR("statusMessage");
      }
      head = { statusCode, statusMessage, headers, autoHeaderBits, keepAliveTimeoutSecs };
    },
    flushHeaders() {
      writeHeadToSocket(null);
    },
    writeHeadAndEnd(
      statusCode,
      statusMessage,
      headers,
      chunk,
      encoding,
      strictContentLength,
      autoHeaderBits,
      keepAliveTimeoutSecs,
    ) {
      // The native NodeHTTPResponse batches writeHead + end into one call;
      // this fallback composes the same two steps.
      this.writeHead(statusCode, statusMessage, headers, autoHeaderBits, keepAliveTimeoutSecs);
      return this.end(chunk, encoding, undefined, strictContentLength);
    },
    write(chunk, encoding, _callback, _strictContentLength) {
      const buf = toBuffer(chunk, encoding);
      writeHeadToSocket(null);
      return writeBody(buf);
    },
    end(chunk, encoding, _callback, _strictContentLength) {
      if (this.ended) return 0;
      const buf = toBuffer(chunk, encoding);
      const length = buf ? (buf.byteLength ?? buf.length) : 0;
      writeHeadToSocket(length);
      writeBody(buf);
      // Like Node's `_hasBody && chunkedEncoding` gate: a bodiless (HEAD)
      // response never writes the terminating chunk, even when the user set
      // Transfer-Encoding: chunked themselves.
      if (chunked && !noBody) socket.write("0\r\n\r\n");
      this.ended = true;
      this.finished = true;
      const onfinished = this.onfinished;
      if (onfinished) {
        this.onfinished = null;
        onfinished();
      }
      // A close-delimited body ends at EOF, so the response ends the connection.
      if (closeDelimited && !socket.destroyed) {
        socket.end();
      }
      return length;
    },
    abort() {
      this.aborted = true;
      if (!socket.destroyed) socket.destroy();
    },
  };
  return handle;
}

// HTTP/1.1 fallback for Http2SecureServer with `allowHTTP1: true`: parses the
// request from the (already decrypted) TLS socket and emits 'request' with
// http.IncomingMessage / http.ServerResponse objects, like node does by routing
// the socket to the HTTP/1 connection listener.
function connectionListenerHTTP1(server, socket, options) {
  const http = require("node:http");
  const { HTTPParser, prepareError } = require("node:_http_common");
  const { kHandle: kHttp1ResponseHandle } = require("internal/http");
  const { allMethods } = process.binding("http_parser");

  const http1Options = options.http1Options || {};
  const IncomingMessageClass = http1Options.IncomingMessage || http.IncomingMessage;
  const ServerResponseClass = http1Options.ServerResponse || http.ServerResponse;
  const keepAliveTimeout = typeof server.keepAliveTimeout === "number" ? server.keepAliveTimeout : 5000;

  const connections = (server[kHttp1Connections] ??= new SafeSet());
  connections.add(socket);
  socket[kHttp1ActiveRequests] = 0;

  const kOnHeaders = HTTPParser.kOnHeaders | 0;
  const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
  const kOnBody = HTTPParser.kOnBody | 0;
  const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;

  const parser = new HTTPParser();
  parser.initialize(HTTPParser.REQUEST, {});

  let req = null;
  // The parser flushes each full 32-slot header block through kOnHeaders and
  // only hands the residual block to kOnHeadersComplete, so requests with more
  // than 31 headers arrive in pieces that must be concatenated.
  let pendingHeaders = [];
  let pendingUrl = "";

  parser[kOnHeaders] = function onHttp1Headers(headers, url) {
    pendingHeaders = pendingHeaders.length === 0 ? headers : pendingHeaders.concat(headers);
    pendingUrl += url;
  };

  parser[kOnHeadersComplete] = function onHttp1HeadersComplete(
    versionMajor,
    versionMinor,
    rawHeaders,
    methodNum,
    url,
    _statusCode,
    _statusMessage,
    upgrade,
    shouldKeepAlive,
  ) {
    if (rawHeaders === undefined) {
      rawHeaders = pendingHeaders;
    } else if (pendingHeaders.length !== 0) {
      rawHeaders = pendingHeaders.concat(rawHeaders);
    }
    pendingHeaders = [];
    if (url === undefined) url = pendingUrl;
    pendingUrl = "";

    socket[kHttp1ActiveRequests]++;

    req = new IncomingMessageClass(socket);
    req.socket = socket;
    req.httpVersionMajor = versionMajor;
    req.httpVersionMinor = versionMinor;
    req.httpVersion = `${versionMajor}.${versionMinor}`;
    req.url = url;
    req.method = typeof methodNum === "number" ? allMethods[methodNum] : methodNum;
    req.upgrade = upgrade;
    req._addHeaderLines(rawHeaders, rawHeaders.length);
    // The body is fed by the parser callbacks below; reading just resumes the socket.
    req._read = function (_size) {
      if (socket.readable) socket.resume();
    };

    const res = new ServerResponseClass(req);
    const handle = createHttp1FallbackResponseHandle(socket, shouldKeepAlive, keepAliveTimeout);
    handle.onfinished = function () {
      socket[kHttp1ActiveRequests] = Math.max(0, (socket[kHttp1ActiveRequests] || 1) - 1);
      if (!shouldKeepAlive && !socket.destroyed) {
        socket.end();
      }
    };
    res[kHttp1ResponseHandle] = handle;
    res.assignSocket(socket);
    // node's resOnFinish: release the socket once the response completes so the next
    // keep-alive request's response can attach (assignSocket throws
    // ERR_HTTP_SOCKET_ASSIGNED while a previous response is still assigned).
    res.on("finish", function onFallbackResponseFinish() {
      this.detachSocket(socket);
    });

    server.emit("request", req, res);
    return 0;
  };
  parser[kOnBody] = function onHttp1Body(chunk) {
    if (req && !req._dumped) req.push(chunk);
  };
  parser[kOnMessageComplete] = function onHttp1MessageComplete() {
    // A chunked body's trailers are flushed through kOnHeaders too; drop them
    // so they can't bleed into the next request on a keep-alive connection.
    pendingHeaders = [];
    pendingUrl = "";
    if (req) {
      req.complete = true;
      req.push(null);
    }
  };

  function onHttp1SocketError(err, rawPacket) {
    // Match Node's http _connectionListener: attach err.rawPacket and, when no
    // 'clientError' listener is present, write the same raw error response
    // Node's socketOnError does before destroying.
    prepareError(err, parser, rawPacket);
    if (!server.emit("clientError", err, socket)) {
      if (socket.writable && !socket.destroyed) {
        const code = err?.code;
        socket.write(
          code === "HPE_HEADER_OVERFLOW"
            ? "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n"
            : "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
          "latin1",
        );
      }
      socket.destroy(err);
    }
  }
  socket.on("data", data => {
    const ret = parser.execute(data);
    if (ret instanceof Error) {
      onHttp1SocketError(ret, data);
    }
  });
  socket.on("error", err => onHttp1SocketError(err, undefined));
  socket.once("close", () => {
    connections.delete(socket);
    try {
      parser.close();
    } catch {}
  });
}

function closeIdleHttp1Connections(server) {
  const connections = server[kHttp1Connections];
  if (!connections) return;
  for (const socket of connections) {
    if (!socket[kHttp1ActiveRequests] && !socket.destroyed) {
      socket.destroy();
    }
  }
}

function connectionListener(socket: Socket) {
  const options = this[bunSocketServerOptions] || {};
  if (socket.alpnProtocol === false || socket.alpnProtocol === "http/1.1") {
    if (options.allowHTTP1 === true) {
      // Fallback to HTTP/1.1
      return connectionListenerHTTP1(this, socket, options);
    }
    // Let event handler deal with the socket

    if (!this.emit("unknownProtocol", socket)) {
      // Install a timeout if the socket was not successfully closed, then
      // destroy the socket to ensure that the underlying resources are
      // released.
      const timer = setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, options.unknownProtocolTimeout);
      // Un-reference the timer to avoid blocking of application shutdown and
      // clear the timeout if the socket was successfully closed.
      timer.unref();

      socket.once("close", () => clearTimeout(timer));

      // We don't know what to do, so let's just tell the other side what's
      // going on in a format that they *might* understand.
      socket.end(
        "HTTP/1.0 403 Forbidden\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Missing ALPN Protocol, expected `h2` to be available.\n" +
          "If this is a HTTP request: The server was not " +
          "configured with the `allowHTTP1` option or a " +
          "listener for the `unknownProtocol` event.\n",
      );
    }
    return;
  }
  // setup session
  const session = new ServerHttp2Session(socket, options, this);

  session.on("error", sessionOnError);
  const timeout = this.timeout;
  if (timeout) session.setTimeout(timeout, sessionOnTimeout);
  this.emit("session", session);
  if (options.origins && $isArray(options.origins)) {
    try {
      session.origin(...options.origins);
    } catch (e) {
      session.emit("frameError", HTTP2_HEADER_ORIGIN, e, 0);
    }
  }
}

function initializeOptions(options) {
  assertIsObject(options, "options");
  options = { ...options };
  assertIsObject(options.settings, "options.settings");
  options.settings = { ...options.settings };

  assertIsArray(options.remoteCustomSettings, "options.remoteCustomSettings");
  if (options.remoteCustomSettings) {
    options.remoteCustomSettings = [...options.remoteCustomSettings];
    if (options.remoteCustomSettings.length > MAX_ADDITIONAL_SETTINGS) throw $ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS();
  }

  if (options.maxSessionInvalidFrames !== undefined)
    validateUint32(options.maxSessionInvalidFrames, "options.maxSessionInvalidFrames");

  if (options.maxSessionRejectedStreams !== undefined) {
    validateUint32(options.maxSessionRejectedStreams, "options.maxSessionRejectedStreams");
  }

  if (options.unknownProtocolTimeout !== undefined)
    validateUint32(options.unknownProtocolTimeout, "options.unknownProtocolTimeout");
  else options.unknownProtocolTimeout = 10000;

  // Initialize http1Options bag for HTTP/1 fallback when allowHTTP1 is true.
  options.http1Options = { ...options.http1Options };
  if (options.Http1IncomingMessage !== undefined) {
    options.http1Options.IncomingMessage ??= options.Http1IncomingMessage;
  }
  if (options.Http1ServerResponse !== undefined) {
    options.http1Options.ServerResponse ??= options.Http1ServerResponse;
  }

  options.Http2ServerRequest ||= Http2ServerRequest;
  options.Http2ServerResponse ||= Http2ServerResponse;
  return options;
}

class Http2Server extends net.Server {
  timeout = 0;
  [kSessions] = new SafeSet();
  constructor(options, onRequestHandler) {
    if (typeof options === "function") {
      onRequestHandler = options;
      options = {};
    }
    options = initializeOptions(options);
    super(options);
    this[kSessions] = new SafeSet();
    this[kOptions] = { settings: options.settings || {} };

    this.setMaxListeners(0);

    // node registers connectionListener at construction time (before any user listener), so it
    // also runs for manually emitted 'connection' events and is not lost when captureRejections
    // installs an own `emit` on the instance (which would shadow a prototype emit override).
    this.on("connection", connectionListener);
    this.on("newListener", setupCompat);
    if (typeof onRequestHandler === "function") {
      this.on("request", onRequestHandler);
    }
  }

  setTimeout(ms, callback) {
    if (callback !== undefined && typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    this.timeout = ms;
    if (typeof callback === "function") {
      this.on("timeout", callback);
    }
    return this;
  }
  updateSettings(settings) {
    assertSettings(settings);
    const options = this[bunSocketServerOptions];
    if (options) {
      options.settings = { ...options.settings, ...settings };
    }
    this[kOptions].settings = { ...this[kOptions].settings, ...settings };
  }

  close(callback?: Function) {
    super.close(callback);
    closeAllSessions(this);
  }
}

Http2Server.prototype[EventEmitter.captureRejectionSymbol] = function (err, event, ...args) {
  switch (event) {
    case "stream": {
      const { 0: stream } = args;
      // node checks sentHeaders here; Bun's server streams keep the request headers in that slot
      // until respond(), so headersSent is the equivalent "has the response been sent" check.
      if (stream.headersSent) {
        stream.destroy(err);
      } else {
        stream.respond({ [HTTP2_HEADER_STATUS]: 500 });
        stream.end();
      }
      break;
    }
    case "request": {
      const { 1: res } = args;
      if (!res.headersSent && !res.finished) {
        // Don't leak headers.
        for (const name of res.getHeaderNames()) {
          res.removeHeader(name);
        }
        res.statusCode = 500;
        res.end(STATUS_CODES[500]);
      } else {
        res.destroy();
      }
      break;
    }
    default:
      // args.unshift(err, event);
      // ReflectApply(net.Server.prototype[EventEmitter.captureRejectionSymbol], this, args);
      break;
  }
};

function onErrorSecureServerSession(err, socket) {
  if (!this.emit("clientError", err, socket)) {
    // The handshake-failed socket has no 'error' listener yet; destroying it with the error
    // would crash the process with an uncaught exception. The failure has already been
    // surfaced through 'tlsClientError'/'clientError'.
    if (!socket.destroyed) socket.destroy();
  }
}

function emitFrameErrorEventNT(stream, frameType, errorCode) {
  stream.emit("frameError", frameType, errorCode);
}
class Http2SecureServer extends tls.Server {
  timeout = 0;
  [kSessions] = new SafeSet();
  constructor(options, onRequestHandler) {
    if (typeof options !== "undefined") {
      if (options && typeof options === "object") {
        options = { ...options };
      } else {
        throw $ERR_INVALID_ARG_TYPE("options", "object", options);
      }
    } else {
      options = {};
    }

    const settings = options.settings;
    if (typeof settings !== "undefined") {
      validateObject(settings, "options.settings");
    }
    if (options.maxSessionInvalidFrames !== undefined)
      validateUint32(options.maxSessionInvalidFrames, "options.maxSessionInvalidFrames");

    if (options.maxSessionRejectedStreams !== undefined) {
      validateUint32(options.maxSessionRejectedStreams, "options.maxSessionRejectedStreams");
    }
    options = initializeOptions(options);
    if (!options.ALPNCallback) {
      options.ALPNProtocols = ["h2"];
      if (options.allowHTTP1 === true) options.ALPNProtocols.push("http/1.1");
    }
    super(options, connectionListener);
    this[kSessions] = new SafeSet();
    this[kOptions] = { settings: settings || {} };
    this.setMaxListeners(0);
    this.on("newListener", setupCompat);
    if (options.allowHTTP1 === true) {
      this[kHttp1Connections] = new SafeSet();
      const http1Options = { ...options, ...options.http1Options };
      this.keepAliveTimeout = http1Options.keepAliveTimeout ?? 5000;
      this.headersTimeout = http1Options.headersTimeout ?? 60000;
      this.requestTimeout = http1Options.requestTimeout ?? 300000;
      this.maxHeadersCount = http1Options.maxHeadersCount ?? null;
      this.maxRequestsPerSocket = http1Options.maxRequestsPerSocket ?? 0;
    }
    if (typeof onRequestHandler === "function") {
      this.on("request", onRequestHandler);
    }
    this.on("tlsClientError", onErrorSecureServerSession);
  }
  emit(event: string, ...args: any[]) {
    if (event === "connection") {
      const socket = args[0];
      if (socket && !(socket instanceof TLSSocket)) {
        return upgradeRawSocketToH2(connectionListener, this, socket);
      }
    }
    return super.emit(event, ...args);
  }
  setTimeout(ms, callback) {
    if (callback !== undefined && typeof callback !== "function") {
      throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    }
    this.timeout = ms;
    if (typeof callback === "function") {
      this.on("timeout", callback);
    }
    return this;
  }
  updateSettings(settings) {
    assertSettings(settings);
    const options = this[bunSocketServerOptions];
    if (options) {
      options.settings = { ...options.settings, ...settings };
    }
    this[kOptions].settings = { ...this[kOptions].settings, ...settings };
  }
  close(callback?: Function) {
    super.close(callback);
    closeIdleHttp1Connections(this);
    closeAllSessions(this);
  }
}
function createServer(options, onRequestHandler) {
  return new Http2Server(options, onRequestHandler);
}
function createSecureServer(options, onRequestHandler) {
  return new Http2SecureServer(options, onRequestHandler);
}
// Establishes a server-side HTTP/2 session over an arbitrary already-connected Duplex
// (https://nodejs.org/api/http2.html#http2performserverhandshakesocket-options).
function performServerHandshake(socket, options = {}) {
  options = initializeOptions(options);
  return new ServerHttp2Session(socket, options, undefined);
}
function getDefaultSettings() {
  // return default settings
  return getUnpackedSettings();
}

Object.defineProperty(connect, promisify.custom, {
  __proto__: null,
  value: function (authority, options) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = connect(authority, options, () => {
      server.removeListener("error", reject);
      return resolve(server);
    });
    server.once("error", reject);
    return promise;
  },
});

export default {
  constants,
  createServer,
  createSecureServer,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  performServerHandshake,
  sensitiveHeaders,
  Http2ServerRequest,
  Http2ServerResponse,
  connect,
  ClientHttp2Session,
  // Internals consumed by the ported node test suite through the --expose-internals shim in
  // test common (require('internal/http2/core') etc.). Symbol.for-keyed so the public module
  // shape stays identical to node's.
  [Symbol.for("::bunhttp2internals::")]: {
    core: {
      Http2Session,
      ServerHttp2Session,
      ClientHttp2Session,
      Http2Stream,
      ServerHttp2Stream,
      ClientHttp2Stream,
    },
    util: {
      assertIsObject,
      assertIsArray,
      assertWithinRange,
      assertValidPseudoHeader,
      sessionName,
      NghttpError,
    },
  },
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
