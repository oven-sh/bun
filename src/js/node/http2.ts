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
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const { $data } = require("node:fs/promises");
const FileHandle = $data.FileHandle;
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const kInfoHeaders = Symbol("sent-info-headers");
const kProxySocket = Symbol("proxySocket");
const kSessions = Symbol("sessions");
const kQuotedString = /^[\x09\x20-\x5b\x5d-\x7e\x80-\xff]*$/;
const MAX_ADDITIONAL_SETTINGS = 10;
const Stream = require("node:stream");
const { Readable } = Stream;
type Http2ConnectOptions = {
  settings?: Settings;
  protocol?: "https:" | "http:";
  createConnection?: Function;
};
const TLSSocket = tls.TLSSocket;
const Socket = net.Socket;
const EventEmitter = require("node:events");
const { Duplex } = require("node:stream");

const { SafeArrayIterator, SafeSet } = require("internal/primordials");

const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;
const ArrayIsArray = Array.isArray;
const ObjectKeys = Object.keys;
const FunctionPrototypeBind = Function.prototype.bind;
const StringPrototypeTrim = String.prototype.trim;
const ArrayPrototypePush = Array.prototype.push;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeIncludes = String.prototype.includes;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const DatePrototypeToUTCString = Date.prototype.toUTCString;
const DatePrototypeGetMilliseconds = Date.prototype.getMilliseconds;

const H2FrameParser = $zig("h2_frame_parser.zig", "H2FrameParserConstructor");
const assertSettings = $newZigFunction("h2_frame_parser.zig", "jsAssertSettings", 1);
const getPackedSettings = $newZigFunction("h2_frame_parser.zig", "jsGetPackedSettings", 1);
const getUnpackedSettings = $newZigFunction("h2_frame_parser.zig", "jsGetUnpackedSettings", 1);

const sensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");
const bunHTTP2Native = Symbol.for("::bunhttp2native::");

const bunHTTP2Socket = Symbol.for("::bunhttp2socket::");
const bunHTTP2OriginSet = Symbol("::bunhttp2originset::");
const bunHTTP2StreamFinal = Symbol.for("::bunHTTP2StreamFinal::");

const bunHTTP2StreamStatus = Symbol.for("::bunhttp2StreamStatus::");

const bunHTTP2Session = Symbol.for("::bunhttp2session::");
const bunHTTP2Headers = Symbol.for("::bunhttp2headers::");

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
const kRequest = Symbol("request");
const kHeadRequest = Symbol("headRequest");
const kMaxStreams = 2 ** 32 - 1;
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
  validateInt32,
  validateBuffer,
  validateNumber,
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
function assertIsObject(value: any, name: string, types?: string): asserts value is object {
  if (value !== undefined && (!$isObject(value) || $isArray(value))) {
    throw $ERR_INVALID_ARG_TYPE(name, types || "Object", value);
  }
}

function assertIsArray(value: any, name: string, types?: string): asserts value is any[] {
  if (value !== undefined && !$isArray(value)) {
    throw $ERR_INVALID_ARG_TYPE(name, types || "Array", value);
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
    this[kHeaders] = { __proto__: null };
    this[kTrailers] = { __proto__: null };
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
    return this[kStream]?.[bunHTTP2Session]?.socket;
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
    const headers = { __proto__: null };
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

    if (state.closed || this.stream.destroyed) return this;
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

  writeEarlyHints(hints) {
    validateObject(hints, "hints");
    const headers = { __proto__: null };
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
  [bunHTTP2Socket]: TLSSocket | Socket | null;
  [bunHTTP2OriginSet]: Set<string> | undefined = undefined;
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
function sessionErrorFromCode(code: number) {
  if (code === 0xe) {
    return $ERR_HTTP2_MAX_PENDING_SETTINGS_ACK();
  }
  return $ERR_HTTP2_SESSION_ERROR(nameForErrorCode[code] || code);
}
hideFromStack(sessionErrorFromCode);

function assertSession(session) {
  if (!session) {
    throw $ERR_HTTP2_INVALID_SESSION();
  }
}
hideFromStack(assertSession);

function pushToStream(stream, data) {
  if (data && stream[bunHTTP2StreamStatus] & StreamState.Closed) {
    if (!stream._readableState.ended) {
      // closed, but not ended, so resume and push null to end the stream
      stream.resume();
      stream.push(null);
    }
    return;
  }

  stream.push(data);
}

enum StreamState {
  EndedCalled = 1 << 0, // 00001 = 1
  WantTrailer = 1 << 1, // 00010 = 2
  FinalCalled = 1 << 2, // 00100 = 4
  Closed = 1 << 3, // 01000 = 8
  StreamResponded = 1 << 4, // 10000 = 16
  WritableClosed = 1 << 5, // 100000 = 32
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
function markStreamClosed(stream: Http2Stream) {
  const status = stream[bunHTTP2StreamStatus];

  if ((status & StreamState.Closed) === 0) {
    stream[bunHTTP2StreamStatus] = status | StreamState.Closed;

    markWritableDone(stream);
  }
}
function rstNextTick(id: number, rstCode: number) {
  const session = this as Http2Session;
  session[bunHTTP2Native]?.rstStream(id, rstCode);
}
class Http2Stream extends Duplex {
  #id: number;
  [bunHTTP2Session]: ClientHttp2Session | ServerHttp2Session | null = null;
  [bunHTTP2StreamFinal]: VoidFunction | null = null;
  [bunHTTP2StreamStatus]: number = 0;

  rstCode: number | undefined = undefined;
  [bunHTTP2Headers]: any;
  [kInfoHeaders]: any;
  #sentTrailers: any;
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

  get bufferSize() {
    const session = this[bunHTTP2Session];
    if (!session) return 0;
    // native queued + socket queued
    return session.bufferSize() + (session[bunHTTP2Socket]?.bufferSize || 0);
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
    } else if (!$isObject(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }
    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    delete headers[sensitiveHeaders];
    if (sensitives) {
      if (!$isJSArray(sensitives)) {
        throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }
    session[bunHTTP2Native]?.sendTrailers(this.#id, headers, sensitiveNames);
    this.#sentTrailers = headers;
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
    return this[bunHTTP2Session];
  }

  get pushAllowed() {
    // not implemented yet aka server side
    return false;
  }
  close(code, callback) {
    if ((this[bunHTTP2StreamStatus] & StreamState.Closed) === 0) {
      const session = this[bunHTTP2Session];
      assertSession(session);
      code = code || 0;
      validateInteger(code, "code", 0, kMaxInt);

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
      markStreamClosed(this);
      this.rstCode = code;
      if (this.writableFinished || code) {
        setImmediate(rstNextTick.bind(session, this.#id, code));
      } else {
        this.once("finish", rstNextTick.bind(session, this.#id, code));
      }
    }
  }
  _destroy(err, callback) {
    const { ending } = this._writableState;
    this.push(null);
    if (!ending) {
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
    // RST code 8 not emitted as an error as its used by clients to signify
    // abort and is already covered by aborted event, also allows more
    // seamless compatibility with http1
    if (err == null && rstCode !== NGHTTP2_NO_ERROR && rstCode !== NGHTTP2_CANCEL)
      err = $ERR_HTTP2_STREAM_ERROR(nameForErrorCode[rstCode] || rstCode);

    markStreamClosed(this);
    this[bunHTTP2Session] = null;
    // This notifies the session that this stream has been destroyed and
    // gives the session the opportunity to clean itself up. The session
    // will destroy if it has been closed and there are no other open or
    // pending streams. Delay with setImmediate so we don't do it on the
    // nghttp2 stack.
    if (session && typeof this.#id === "number") {
      setImmediate(rstNextTick.bind(session, this.#id, rstCode));
    }

    callback(err);
  }

  _final(callback) {
    const status = this[bunHTTP2StreamStatus];

    const session = this[bunHTTP2Session];
    if (session) {
      const native = session[bunHTTP2Native];
      if (native) {
        this[bunHTTP2StreamStatus] |= StreamState.FinalCalled;
        native.writeStream(this.#id, "", "ascii", true, callback);
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
    // we always use the internal stream queue now
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
      return;
    }
    if (!chunk) {
      chunk = Buffer.alloc(0);
    }
    this[bunHTTP2StreamStatus] = status | StreamState.EndedCalled;
    return super.end(chunk, encoding, callback);
  }

  _writev(data, callback) {
    const session = this[bunHTTP2Session];
    if (session) {
      const native = session[bunHTTP2Native];
      if (native) {
        const allBuffers = data.allBuffers;
        let chunks;
        chunks = data;
        if (allBuffers) {
          for (let i = 0; i < data.length; i++) {
            data[i] = data[i].chunk;
          }
        } else {
          for (let i = 0; i < data.length; i++) {
            const { chunk, encoding } = data[i];
            if (typeof chunk === "string") {
              data[i] = Buffer.from(chunk, encoding);
            } else {
              data[i] = chunk;
            }
          }
        }
        const chunk = Buffer.concat(chunks || []);
        native.writeStream(this.#id, chunk, undefined, false, callback);
        return;
      }
    }
    if (typeof callback == "function") {
      callback();
    }
  }
  _write(chunk, encoding, callback) {
    const session = this[bunHTTP2Session];
    if (session) {
      const native = session[bunHTTP2Native];
      if (native) {
        native.writeStream(this.#id, chunk, encoding, false, callback);
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
class ClientHttp2Stream extends Http2Stream {
  constructor(streamId, session, headers) {
    super(streamId, session, headers);
  }
}
function tryClose(fd) {
  try {
    fs.close(fd);
  } catch {}
}

function doSendFileFD(options, fd, headers, err, stat) {
  const onError = options.onError;
  if (err) {
    if (err.code !== "EBADF") {
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
      tryClose(fd);
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
    tryClose(fd);
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
    tryClose(fd);
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
    fs.createReadStream(null, {
      fd: fd,
      autoClose: false,
      start: statOptions.offset ? statOptions.offset : undefined,
      end: typeof statOptions.length === "number" ? statOptions.length + (statOptions.offset || 0) - 1 : undefined,
      emitClose: false,
    }).pipe(this);
  } catch (err) {
    if (typeof onError === "function") {
      onError(err);
    } else {
      this.destroy(err);
    }
  }
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

class ServerHttp2Stream extends Http2Stream {
  headersSent = false;
  constructor(streamId, session, headers) {
    super(streamId, session, headers);
  }
  pushStream() {
    throw $ERR_HTTP2_PUSH_DISABLED();
  }

  respondWithFile(path, headers, options) {
    if (this.destroyed) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();

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
    fs.open(path, "r", afterOpen.bind(this, options || {}, headers));
  }
  respondWithFD(fd, headers, options) {
    if (this.destroyed) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();

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
    if (fd instanceof FileHandle) {
      fs.fstat(fd.fd, doSendFileFD.bind(this, options, fd, headers));
    } else {
      fs.fstat(fd, doSendFileFD.bind(this, options, fd, headers));
    }
  }
  additionalHeaders(headers) {
    if (this.destroyed || this.closed) {
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
    } else if (!$isObject(headers)) {
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
    delete headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isArray(sensitives)) {
        throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }
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
    if (this.destroyed) {
      throw $ERR_HTTP2_INVALID_STREAM();
    }

    const session = this[bunHTTP2Session];
    assertSession(session);
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();
    if (this.sentTrailers) {
      throw $ERR_HTTP2_TRAILERS_ALREADY_SENT();
    }

    if (headers == undefined) {
      headers = {};
    } else if (!$isObject(headers)) {
      throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
    } else {
      headers = { ...headers };
    }

    const sensitives = headers[sensitiveHeaders];
    delete headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isArray(sensitives)) {
        throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }
    if (headers[HTTP2_HEADER_STATUS] === undefined) {
      headers[HTTP2_HEADER_STATUS] = 200;
    }
    const statusCode = headers[HTTP2_HEADER_STATUS];
    let endStream = !!options?.endStream;
    if (
      endStream ||
      statusCode === HTTP_STATUS_NO_CONTENT ||
      statusCode === HTTP_STATUS_RESET_CONTENT ||
      statusCode === HTTP_STATUS_NOT_MODIFIED ||
      this.headRequest === true
    ) {
      options = { ...options, endStream: true };
      endStream = true;
    }
    const sendDate = options?.sendDate;
    if (sendDate == null || sendDate) {
      const current_date = headers["date"];
      if (current_date == null) {
        headers["date"] = utcDate();
      }
    }

    if (typeof options === "undefined") {
      session[bunHTTP2Native]?.request(this.id, undefined, headers, sensitiveNames);
    } else {
      session[bunHTTP2Native]?.request(this.id, undefined, headers, sensitiveNames, options);
    }
    this.headersSent = true;
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

function emitStreamErrorNT(self, stream, error, destroy, destroy_self) {
  if (stream) {
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
    markStreamClosed(stream);
    if (destroy) stream.destroy(error_instance, stream.rstCode);
    else if (error_instance) {
      stream.emit("error", error_instance);
    }

    if (destroy_self) self.destroy();
  }
}
//TODO: do this in C++
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
  /// close indicates that we called closed
  #closed: boolean = false;
  /// connected indicates that the connection/socket is connected
  #connected: boolean = false;
  #connections: number = 0;
  #socket_proxy: Proxy<TLSSocket | Socket>;
  #parser: typeof H2FrameParser | null;
  #url: URL;
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
    streamStart(self: ServerHttp2Session, stream_id: number) {
      if (!self) return;
      self.#connections++;
      const stream = new ServerHttp2Stream(stream_id, self, null);
      self.#parser?.setStreamContext(stream_id, stream);
    },
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
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamError(self: ServerHttp2Session, stream: ServerHttp2Stream, error: number) {
      if (!self || typeof stream !== "object") return;
      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamEnd(self: ServerHttp2Session, stream: ServerHttp2Stream, state: number) {
      if (!self || typeof stream !== "object") return;
      if (state == 6 || state == 7) {
        if (stream.readable) {
          if (!stream.rstCode) {
            stream.rstCode = 0;
          }
          pushToStream(stream, null);

          // If the user hasn't tried to consume the stream (and this is a server
          // session) then just dump the incoming data so that the stream can
          // be destroyed.
          if (stream.readableFlowing === null) {
            stream.resume();
          }
        }
      }
      // 7 = closed, in this case we already send everything and received everything
      if (state === 7) {
        markStreamClosed(stream);
        self.#connections--;
        stream.destroy();
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
    },
    streamHeaders(
      self: ServerHttp2Session,
      stream: ServerHttp2Stream,
      rawheaders: string[],
      sensitiveHeadersValue: string[] | undefined,
      flags: number,
    ) {
      if (!self || typeof stream !== "object" || self.closed || stream.closed) return;
      const headers = toHeaderObject(rawheaders, sensitiveHeadersValue || []);
      if (headers[HTTP2_HEADER_METHOD] === HTTP2_METHOD_HEAD) {
        stream[kHeadRequest] = true;
      }
      const status = stream[bunHTTP2StreamStatus];
      if ((status & StreamState.StreamResponded) !== 0) {
        stream.emit("trailers", headers, flags, rawheaders);
      } else {
        self[kServer].emit("stream", stream, headers, flags, rawheaders);

        stream[bunHTTP2StreamStatus] = status | StreamState.StreamResponded;
        self.emit("stream", stream, headers, flags, rawheaders);
      }
    },
    localSettings(self: ServerHttp2Session, settings: Settings) {
      if (!self) return;
      self.#localSettings = settings;
      self.#pendingSettingsAck = false;
      self.emit("localSettings", settings);
    },
    remoteSettings(self: ServerHttp2Session, settings: Settings) {
      if (!self) return;
      self.#remoteSettings = settings;
      self.emit("remoteSettings", settings);
    },
    ping(self: ServerHttp2Session, payload: Buffer, isACK: boolean) {
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
    error(self: ServerHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.destroy(errorCode);
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
      self.emit("goaway", errorCode, lastStreamId, opaqueData || Buffer.allocUnsafe(0));
      if (errorCode !== 0) {
        self.#parser.emitErrorToAllStreams(errorCode);
      }
      self.close();
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
    this.#parser?.read(data);
  }

  #onClose() {
    const parser = this.#parser;
    if (parser) {
      parser.emitAbortToAllStreams();
      parser.detach();
      this.#parser = null;
    }
    this.close();
  }

  #onError(error: Error) {
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

  constructor(socket: TLSSocket | Socket, options?: Http2ConnectOptions, server?: Http2Server) {
    super();
    this[kServer] = server;
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
    this.#encrypted = socket instanceof TLSSocket;

    this.#parser = new H2FrameParser({
      native: nativeSocket,
      context: this,
      settings: { ...options, ...options?.settings },
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
      throw $ERR_INVALID_ARG_TYPE("payload", ["Buffer", "TypedArray"], payload);
    }
    const parser = this.#parser;
    if (!parser) return false;
    if (!this[bunHTTP2Socket]) return false;

    if (typeof callback === "function") {
      if (payload.byteLength !== 8) {
        const error = $ERR_HTTP2_PING_LENGTH();
        callback(error, 0, payload);
        return;
      }
      if (this.#pingCallbacks) {
        this.#pingCallbacks.push([callback, Date.now()]);
      } else {
        this.#pingCallbacks = [[callback, Date.now()]];
      }
    } else if (payload.byteLength !== 8) {
      throw $ERR_HTTP2_PING_LENGTH();
    }

    parser.ping(payload);
    return true;
  }
  goaway(code = NGHTTP2_NO_ERROR, lastStreamID = 0, opaqueData) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    if (opaqueData !== undefined) {
      validateBuffer(opaqueData, "opaqueData");
    }
    validateNumber(code, "code");
    validateNumber(lastStreamID, "lastStreamID");
    return this.#parser?.goaway(code, lastStreamID, opaqueData);
  }

  setLocalWindowSize(windowSize) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    validateInt32(windowSize, "windowSize", 0, kMaxWindowSize);
    return this.#parser?.setLocalWindowSize?.(windowSize);
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

  // Gracefully closes the Http2Session, allowing any existing streams to complete on their own and preventing new Http2Stream instances from being created. Once closed, http2session.destroy() might be called if there are no open Http2Stream instances.
  // If specified, the callback function is registered as a handler for the 'close' event.
  close(callback?: Function) {
    this.#closed = true;

    if (typeof callback === "function") {
      this.on("close", callback);
    }
    if (this.#connections === 0) {
      this.destroy();
    }
  }

  destroy(error: Error | number | undefined = NGHTTP2_NO_ERROR, code?: number) {
    const server = this[kServer];
    if (server) {
      server[kSessions].delete(this);
    }
    if (typeof error === "number") {
      code = error;
      error = code !== NGHTTP2_NO_ERROR ? $ERR_HTTP2_SESSION_ERROR(code) : undefined;
    }

    const socket = this[bunHTTP2Socket];
    if (!this.#connected) return;
    this.#closed = true;
    this.#connected = false;
    if (socket) {
      this.goaway(code || constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
      socket.end();
    }
    const parser = this.#parser;
    if (parser) {
      parser.emitErrorToAllStreams(code || constants.NGHTTP2_NO_ERROR);
      parser.detach();
      this.#parser = null;
    }
    this[bunHTTP2Socket] = null;

    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
  }
}
function emitTimeout(session: ClientHttp2Session) {
  session.emit("timeout");
}
function streamCancel(stream: Http2Stream) {
  stream.close(NGHTTP2_CANCEL);
}
class ClientHttp2Session extends Http2Session {
  /// close indicates that we called closed
  #closed: boolean = false;
  /// connected indicates that the connection/socket is connected
  #connected: boolean = false;
  #connections: number = 0;

  #socket_proxy: Proxy<TLSSocket | Socket>;
  #parser: typeof H2FrameParser | null;
  #url: URL;
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
    streamStart(self: ClientHttp2Session, stream_id: number) {
      if (!self) return;
      self.#connections++;
      if (stream_id % 2 === 0) {
        // pushStream
        const stream = new ClientHttp2Session(stream_id, self, null);
        self.#parser?.setStreamContext(stream_id, stream);
      }
    },
    frameError(self: ClientHttp2Session, stream: ClientHttp2Stream, frameType: number, errorCode: number) {
      if (!self || typeof stream !== "object") return;
      // Emit the frameError event with the frame type and error code
      process.nextTick(emitFrameErrorEventNT, stream, frameType, errorCode);
    },
    aborted(self: ClientHttp2Session, stream: ClientHttp2Stream, error: any, old_state: number) {
      if (!self || typeof stream !== "object") return;
      stream.rstCode = constants.NGHTTP2_CANCEL;
      // if writable and not closed emit aborted
      if (old_state != 5 && old_state != 7) {
        stream[kAborted] = true;
        stream.emit("aborted");
      }
      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamError(self: ClientHttp2Session, stream: ClientHttp2Stream, error: number) {
      if (!self || typeof stream !== "object") return;

      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamEnd(self: ClientHttp2Session, stream: ClientHttp2Stream, state: number) {
      if (!self || typeof stream !== "object") return;

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
        markStreamClosed(stream);
        self.#connections--;
        stream.destroy();
        if (self.#connections === 0 && self.#closed) {
          self.destroy();
        }
      } else if (state === 5) {
        // 5 = local closed aka write is closed
        markWritableDone(stream);
      }
    },
    streamData(self: ClientHttp2Session, stream: ClientHttp2Stream, data: Buffer) {
      if (!self || typeof stream !== "object" || !data) return;
      pushToStream(stream, data);
    },
    streamHeaders(
      self: ClientHttp2Session,
      stream: ClientHttp2Stream,
      rawheaders: string[],
      sensitiveHeadersValue: string[] | undefined,
      flags: number,
    ) {
      if (!self || typeof stream !== "object" || stream.rstCode) return;
      const headers = toHeaderObject(rawheaders, sensitiveHeadersValue || []);
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
          stream[bunHTTP2StreamStatus] = status | StreamState.StreamResponded;
          if (header_status === 421) {
            // 421 Misdirected Request
            removeOriginFromSet(self, stream);
          }
          self.emit("stream", stream, headers, flags, rawheaders);
          stream.emit("response", headers, flags, rawheaders);
        }
      }
    },
    localSettings(self: ClientHttp2Session, settings: Settings) {
      if (!self) return;
      self.#localSettings = settings;
      self.#pendingSettingsAck = false;
      self.emit("localSettings", settings);
    },
    remoteSettings(self: ClientHttp2Session, settings: Settings) {
      if (!self) return;
      self.#remoteSettings = settings;
      self.emit("remoteSettings", settings);
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
      const error_instance = sessionErrorFromCode(errorCode);
      self.destroy(error_instance);
    },

    wantTrailers(self: ClientHttp2Session, stream: ClientHttp2Stream) {
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
    goaway(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.emit("goaway", errorCode, lastStreamId, opaqueData || Buffer.allocUnsafe(0));
      if (self.closed) return;
      self.destroy(undefined, errorCode);
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
    }
    process.nextTick(emitConnectNT, this, socket);
    this.#parser.flush();
  }

  #onClose() {
    const parser = this.#parser;
    const err = this.connecting ? $ERR_SOCKET_CLOSED() : null;
    if (parser) {
      parser.forEachStream(streamCancel);
      parser.detach();
      this.#parser = null;
    }
    this.destroy(err, NGHTTP2_NO_ERROR);
    this[bunHTTP2Socket] = null;
  }
  #onError(error: Error) {
    this[bunHTTP2Socket] = null;
    if (this.#closed) {
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
    return 1;
  }
  unref() {
    return this[bunHTTP2Socket]?.unref();
  }
  ref() {
    return this[bunHTTP2Socket]?.ref();
  }
  setNextStreamID(id) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    validateNumber(id, "id");
    if (id <= 0 || id > kMaxStreams) throw $ERR_OUT_OF_RANGE("id", `> 0 and <= ${kMaxStreams}`, id);
    this.#parser?.setNextStreamID(id);
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
      throw $ERR_INVALID_ARG_TYPE("payload", ["Buffer", "TypedArray"], payload);
    }
    const parser = this.#parser;
    if (!parser) return false;
    if (!this[bunHTTP2Socket]) return false;

    if (typeof callback === "function") {
      if (payload.byteLength !== 8) {
        const error = $ERR_HTTP2_PING_LENGTH();
        callback(error, 0, payload);
        return;
      }
      if (this.#pingCallbacks) {
        this.#pingCallbacks.push([callback, Date.now()]);
      } else {
        this.#pingCallbacks = [[callback, Date.now()]];
      }
    } else if (payload.byteLength !== 8) {
      throw $ERR_HTTP2_PING_LENGTH();
    }

    parser.ping(payload);
    return true;
  }
  goaway(errorCode, lastStreamId, opaqueData) {
    return this.#parser?.goaway(errorCode, lastStreamId, opaqueData);
  }

  setLocalWindowSize(windowSize) {
    if (this.destroyed) throw $ERR_HTTP2_INVALID_SESSION();

    validateInt32(windowSize, "windowSize", 0, kMaxWindowSize);
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

    this.#parser = new H2FrameParser({
      native: nativeSocket,
      context: this,
      settings: { ...options, ...options?.settings },
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
    if (this.#closed && !this.#connected && !this.#parser) {
      return;
    }
    this.#closed = true;
    this.#connected = false;
    if (socket) {
      this.goaway(code || constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
      socket.end();
    }
    const parser = this.#parser;
    if (parser) {
      parser.emitErrorToAllStreams(code || constants.NGHTTP2_NO_ERROR);
      parser.detach();
    }
    this.#parser = null;
    this[bunHTTP2Socket] = null;

    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
  }

  request(headers: any, options?: any) {
    try {
      if (this.destroyed || this.closed) {
        throw $ERR_HTTP2_INVALID_STREAM();
      }

      if (this.sentTrailers) {
        throw $ERR_HTTP2_TRAILERS_ALREADY_SENT();
      }

      if (headers == undefined) {
        headers = {};
      } else if (!$isObject(headers)) {
        throw $ERR_INVALID_ARG_TYPE("headers", "object", headers);
      } else {
        headers = { ...headers };
      }

      const sensitives = headers[sensitiveHeaders];
      delete headers[sensitiveHeaders];
      const sensitiveNames = {};
      if (sensitives) {
        if (!$isArray(sensitives)) {
          throw $ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]", sensitives);
        }
        for (let i = 0; i < sensitives.length; i++) {
          sensitiveNames[sensitives[i]] = true;
        }
      }
      const url = this.#url;

      let authority = headers[":authority"];
      if (!authority) {
        authority = url.host;
        if (!headers["host"]) {
          headers[":authority"] = authority;
        }
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

      if (headers[":path"] == undefined) {
        headers[":path"] = "/";
      }

      if (NoPayloadMethods.has(method.toUpperCase())) {
        if (!options || !$isObject(options)) {
          options = { endStream: true };
        } else {
          options = { ...options, endStream: true };
        }
      }
      let stream_id: number = this.#parser.getNextStream();
      if (stream_id < 0) {
        const req = new ClientHttp2Stream(undefined, this, headers);
        process.nextTick(emitOutofStreamErrorNT, req);
        return req;
      }
      const req = new ClientHttp2Stream(stream_id, this, headers);
      req.authority = authority;
      req[kHeadRequest] = method === HTTP2_METHOD_HEAD;
      if (typeof options === "undefined") {
        this.#parser.request(stream_id, req, headers, sensitiveNames);
      } else {
        this.#parser.request(stream_id, req, headers, sensitiveNames, options);
      }
      process.nextTick(emitEventNT, req, "ready");
      return req;
    } catch (e: any) {
      this.#connections--;
      process.nextTick(emitErrorNT, this, e, this.#connections === 0 && this.#closed);
      throw e;
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

function connectionListener(socket: Socket) {
  const options = this[bunSocketServerOptions] || {};
  if (socket.alpnProtocol === false || socket.alpnProtocol === "http/1.1") {
    // TODO: Fallback to HTTP/1.1
    // if (options.allowHTTP1 === true) {

    // }
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
    validateUint32(options.maxSessionInvalidFrames, "maxSessionInvalidFrames");

  if (options.maxSessionRejectedStreams !== undefined) {
    validateUint32(options.maxSessionRejectedStreams, "maxSessionRejectedStreams");
  }

  if (options.unknownProtocolTimeout !== undefined)
    validateUint32(options.unknownProtocolTimeout, "unknownProtocolTimeout");
  else options.unknownProtocolTimeout = 10000;

  // Used only with allowHTTP1
  // options.Http1IncomingMessage ||= http.IncomingMessage;
  // options.Http1ServerResponse ||= http.ServerResponse;

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
    super(options, connectionListener);
    this[kSessions] = new SafeSet();

    this.setMaxListeners(0);

    this.on("newListener", setupCompat);
    if (typeof onRequestHandler === "function") {
      this.on("request", onRequestHandler);
    }
  }

  setTimeout(ms, callback) {
    this.timeout = ms;
    if (typeof callback === "function") {
      this.on("timeout", callback);
    }
  }
  updateSettings(settings) {
    assertSettings(settings);
    const options = this[bunSocketServerOptions];
    if (options) {
      options.settings = { ...options.settings, ...settings };
    }
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
      if (stream.sentHeaders) {
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
  if (!this.emit("clientError", err, socket)) socket.destroy(err);
}
function emitFrameErrorEventNT(stream, frameType, errorCode) {
  stream.emit("frameError", frameType, errorCode);
}
class Http2SecureServer extends tls.Server {
  timeout = 0;
  [kSessions] = new SafeSet();
  constructor(options, onRequestHandler) {
    //TODO: add 'http/1.1' on ALPNProtocols list after allowHTTP1 support
    if (typeof options !== "undefined") {
      if (options && typeof options === "object") {
        options = { ...options, ALPNProtocols: ["h2"] };
      } else {
        throw $ERR_INVALID_ARG_TYPE("options", "object", options);
      }
    } else {
      options = { ALPNProtocols: ["h2"] };
    }

    const settings = options.settings;
    if (typeof settings !== "undefined") {
      validateObject(settings, "options.settings");
    }
    if (options.maxSessionInvalidFrames !== undefined)
      validateUint32(options.maxSessionInvalidFrames, "maxSessionInvalidFrames");

    if (options.maxSessionRejectedStreams !== undefined) {
      validateUint32(options.maxSessionRejectedStreams, "maxSessionRejectedStreams");
    }
    super(options, connectionListener);
    this[kSessions] = new SafeSet();
    this.setMaxListeners(0);
    this.on("newListener", setupCompat);
    if (typeof onRequestHandler === "function") {
      this.on("request", onRequestHandler);
    }
    this.on("tlsClientError", onErrorSecureServerSession);
  }
  setTimeout(ms, callback) {
    this.timeout = ms;
    if (typeof callback === "function") {
      this.on("timeout", callback);
    }
  }
  updateSettings(settings) {
    assertSettings(settings);
    const options = this[bunSocketServerOptions];
    if (options) {
      options.settings = { ...options.settings, ...settings };
    }
  }
  close(callback?: Function) {
    super.close(callback);
    closeAllSessions(this);
  }
}
function createServer(options, onRequestHandler) {
  return new Http2Server(options, onRequestHandler);
}
function createSecureServer(options, onRequestHandler) {
  return new Http2SecureServer(options, onRequestHandler);
}
function getDefaultSettings() {
  // return default settings
  return getUnpackedSettings();
}

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
