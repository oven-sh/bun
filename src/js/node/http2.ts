// Hardcoded module "node:http2"

const { isTypedArray } = require("node:util/types");

// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");

const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");

const { ERR_INVALID_ARG_TYPE, ERR_INVALID_HTTP_TOKEN, ERR_INVALID_ARG_VALUE } = require("internal/errors");
class ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED extends TypeError {
  constructor() {
    super("Cannot set HTTP/2 pseudo-headers");
    this.code = "ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED";
  }
}

class ERR_HTTP2_INVALID_HEADER_VALUE extends TypeError {
  constructor(message, token) {
    super(`Invalid value "${message}" for header "${token}"`);
    this.code = "ERR_HTTP2_INVALID_HEADER_VALUE";
  }
}

class ERR_HTTP2_HEADERS_SENT extends Error {
  constructor() {
    super("Response has already been initiated");
    this.code = "ERR_HTTP2_HEADERS_SENT";
  }
}
class ERR_HTTP2_INFO_STATUS_NOT_ALLOWED extends RangeError {
  constructor() {
    super("Informational status codes cannot be used");
    this.code = "ERR_HTTP2_INFO_STATUS_NOT_ALLOWED";
  }
}
class ERR_HTTP2_STATUS_INVALID extends RangeError {
  constructor(status) {
    super(`Invalid status code: ${status}`);
    this.code = "ERR_HTTP2_STATUS_INVALID";
  }
}
class ERR_HTTP2_INVALID_PSEUDOHEADER extends TypeError {
  constructor(key) {
    super(`"${key}" is an invalid pseudoheader or is used incorrectly`);
    this.code = "ERR_HTTP2_INVALID_PSEUDOHEADER";
  }
}
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const bunSocketInternal = Symbol.for("::bunnetsocketinternal::");

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

const {
  FunctionPrototypeBind,
  StringPrototypeTrim,
  ArrayPrototypePush,
  ObjectAssign,
  ArrayIsArray,
  SafeArrayIterator,
  StringPrototypeToLowerCase,
  StringPrototypeIncludes,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  SafeSet,
} = require("internal/primordials");
const RegExpPrototypeExec = RegExp.prototype.exec;

const [H2FrameParser, getPackedSettings, getUnpackedSettings] = $zig("h2_frame_parser.zig", "createNodeHttp2Binding");

const sensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");
const bunHTTP2Native = Symbol.for("::bunhttp2native::");
const bunHTTP2StreamResponded = Symbol.for("::bunhttp2hasResponded::");
const bunHTTP2StreamReadQueue = Symbol.for("::bunhttp2ReadQueue::");
const bunHTTP2Closed = Symbol.for("::bunhttp2closed::");
const bunHTTP2Socket = Symbol.for("::bunhttp2socket::");
const bunHTTP2WantTrailers = Symbol.for("::bunhttp2WantTrailers::");
const bunHTTP2Session = Symbol.for("::bunhttp2session::");
const bunHTTP2Headers = Symbol.for("::bunhttp2headers::");

const ReflectGetPrototypeOf = Reflect.getPrototypeOf;

const kBeginSend = Symbol("begin-send");
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

function validateString(value, name) {
  if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}
function validateFunction(value, name) {
  if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
}
hideFromStack(validateString);
hideFromStack(validateFunction);

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val) {
  return RegExpPrototypeExec.$call(tokenRegExp, val) !== null;
}

function getAuthority(headers) {
  // For non-CONNECT requests, HTTP/2 allows either :authority
  // or Host to be used equivalently. The first is preferred
  // when making HTTP/2 requests, and the latter is preferred
  // when converting from an HTTP/1 message.
  if (headers[constants.HTTP2_HEADER_AUTHORITY] !== undefined) return headers[constants.HTTP2_HEADER_AUTHORITY];
  if (headers[constants.HTTP2_HEADER_HOST] !== undefined) return headers[constants.HTTP2_HEADER_HOST];
}
function onStreamData(chunk) {
  const request = this[kRequest];
  if (request !== undefined && !request.push(chunk)) this.pause();
}

function onStreamTrailers(trailers, flags, rawTrailers) {
  const request = this[kRequest];
  if (request !== undefined) {
    ObjectAssign(request[kTrailers], trailers);
    ArrayPrototypePush(request[kRawTrailers], ...new SafeArrayIterator(rawTrailers));
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
    case constants.HTTP2_HEADER_STATUS: // :status
    case constants.HTTP2_HEADER_METHOD: // :method
    case constants.HTTP2_HEADER_PATH: // :path
    case constants.HTTP2_HEADER_AUTHORITY: // :authority
    case constants.HTTP2_HEADER_SCHEME: // :scheme
      return true;
    default:
      return false;
  }
}

function isConnectionHeaderAllowed(name, value) {
  return name !== constants.HTTP2_HEADER_CONNECTION || value === "trailers";
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
  if (name === "" || typeof name !== "string" || StringPrototypeIncludes(name, " ")) {
    throw new ERR_INVALID_HTTP_TOKEN("Header name", name);
  }
  if (isPseudoHeader(name)) {
    throw new ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED();
  }
  if (value === undefined || value === null) {
    throw new ERR_HTTP2_INVALID_HEADER_VALUE(value, name);
  }
  if (!isConnectionHeaderAllowed(name, value)) {
    connectionHeaderMessageWarn();
  }
}

hideFromStack(assertValidHeader);

class Http2ServerRequest extends Readable {
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
    stream.on("timeout", onStreamTimeout);
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
    return stream?.socket;
  }

  get connection() {
    return this.socket;
  }

  _read(nread) {
    const state = this[kState];
    assert(!state.closed);
    if (!state.didRead) {
      state.didRead = true;
      this[kStream].on("data", onStreamData);
    } else {
      process.nextTick(resumeStream, this[kStream]);
    }
  }

  get method() {
    return this[kHeaders][constants.HTTP2_HEADER_METHOD];
  }

  set method(method) {
    validateString(method, "method");
    if (StringPrototypeTrim(method) === "") throw new ERR_INVALID_ARG_VALUE("method", method);

    this[kHeaders][constants.HTTP2_HEADER_METHOD] = method;
  }

  get authority() {
    return getAuthority(this[kHeaders]);
  }

  get scheme() {
    return this[kHeaders][constants.HTTP2_HEADER_SCHEME];
  }

  get url() {
    return this[kHeaders][constants.HTTP2_HEADER_PATH];
  }

  set url(url) {
    this[kHeaders][constants.HTTP2_HEADER_PATH] = url;
  }

  setTimeout(msecs, callback) {
    if (!this[kState].closed) this[kStream].setTimeout(msecs, callback);
    return this;
  }
}
class Http2ServerResponse extends Stream {
  constructor(stream, options) {
    super(options);
    this[kState] = {
      closed: false,
      ending: false,
      destroyed: false,
      headRequest: false,
      sendDate: true,
      statusCode: constants.HTTP_STATUS_OK,
    };
    this[kHeaders] = { __proto__: null };
    this[kTrailers] = { __proto__: null };
    this[kStream] = stream;
    stream[kResponse] = this;
    this.writable = true;
    this.req = stream[kRequest];
    stream.on("drain", onStreamDrain);
    stream.on("close", onStreamCloseResponse);
    stream.on("wantTrailers", onStreamTrailersReady);
    stream.on("timeout", onStreamTimeout);
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
    return stream?.socket;
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
    if (code >= 100 && code < 200) throw new ERR_HTTP2_INFO_STATUS_NOT_ALLOWED();
    if (code < 100 || code > 599) throw new ERR_HTTP2_STATUS_INVALID(code);
    this[kState].statusCode = code;
  }

  setTrailer(name, value) {
    validateString(name, "name");
    name = StringPrototypeToLowerCase(StringPrototypeTrim(name));
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
    name = StringPrototypeToLowerCase(StringPrototypeTrim(name));
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
    name = StringPrototypeToLowerCase(StringPrototypeTrim(name));
    return ObjectPrototypeHasOwnProperty(this[kHeaders], name);
  }

  removeHeader(name) {
    validateString(name, "name");
    if (this[kStream].headersSent) throw new ERR_HTTP2_HEADERS_SENT();

    name = StringPrototypeToLowerCase(StringPrototypeTrim(name));

    if (name === "date") {
      this[kState].sendDate = false;

      return;
    }

    delete this[kHeaders][name];
  }

  setHeader(name, value) {
    validateString(name, "name");
    if (this[kStream].headersSent) throw new ERR_HTTP2_HEADERS_SENT();

    this[kSetHeader](name, value);
  }

  [kSetHeader](name, value) {
    name = StringPrototypeToLowerCase(StringPrototypeTrim(name));
    assertValidHeader(name, value);

    if (!isConnectionHeaderAllowed(name, value)) {
      return;
    }

    if (name[0] === ":") assertValidPseudoHeader(name);
    else if (!checkIsHttpToken(name)) this.destroy(new ERR_INVALID_HTTP_TOKEN("Header name", name));

    this[kHeaders][name] = value;
  }

  appendHeader(name, value) {
    validateString(name, "name");
    if (this[kStream].headersSent) throw new ERR_HTTP2_HEADERS_SENT();

    this[kAppendHeader](name, value);
  }

  [kAppendHeader](name, value) {
    name = StringPrototypeToLowerCase(StringPrototypeTrim(name));
    assertValidHeader(name, value);

    if (!isConnectionHeaderAllowed(name, value)) {
      return;
    }

    if (name[0] === ":") assertValidPseudoHeader(name);
    else if (!checkIsHttpToken(name)) this.destroy(new ERR_INVALID_HTTP_TOKEN("Header name", name));

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

  writeHead(statusCode, statusMessage, headers) {
    const state = this[kState];

    if (state.closed || this.stream.destroyed) return this;
    if (this[kStream].headersSent) throw new ERR_HTTP2_HEADERS_SENT();

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
          throw new ERR_INVALID_ARG_VALUE("headers", headers);
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

  write(chunk, encoding, cb) {
    const state = this[kState];

    if (typeof encoding === "function") {
      cb = encoding;
      encoding = "utf8";
    }

    let err;
    if (state.ending) {
      err = new ERR_STREAM_WRITE_AFTER_END();
    } else if (state.closed) {
      err = new ERR_HTTP2_INVALID_STREAM();
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
      process.nextTick(callback, new ERR_HTTP2_INVALID_STREAM());
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
    headers[constants.HTTP2_HEADER_STATUS] = state.statusCode;
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
      [constants.HTTP2_HEADER_STATUS]: HTTP_STATUS_CONTINUE,
    });
    return true;
  }

  writeEarlyHints(hints) {
    //TODO: RE-ENABLE when tested
    //   validateObject(hints, "hints");
    //   const headers = { __proto__: null };
    //   const linkHeaderValue = validateLinkHeaderValue(hints.link);
    //   for (const key of ObjectKeys(hints)) {
    //     if (key !== "link") {
    //       headers[key] = hints[key];
    //     }
    //   }
    //   if (linkHeaderValue.length === 0) {
    //     return false;
    //   }
    //   const stream = this[kStream];
    //   if (stream.headersSent || this[kState].closed) return false;
    //   stream.additionalHeaders({
    //     ...headers,
    //     [constants.HTTP2_HEADER_STATUS]: constants.HTTP_STATUS_EARLY_HINTS,
    //     "Link": linkHeaderValue,
    //   });
    //   return true;
  }
}

function onServerStream(stream, headers, flags, rawHeaders) {
  const server = this;
  const request = new Http2ServerRequest(stream, headers, undefined, rawHeaders);
  const response = new Http2ServerResponse(stream);

  // Check for the CONNECT method
  const method = headers[constants.HTTP2_HEADER_METHOD];
  if (method === "CONNECT") {
    if (!server.emit("connect", request, response)) {
      response.statusCode = constants.HTTP_STATUS_METHOD_NOT_ALLOWED;
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
      response.statusCode = constants.HTTP_STATUS_EXPECTATION_FAILED;
      response.end();
    }
    return;
  }

  server.emit("request", request, response);
}

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
//TODO: desconstruct used constants.

// This set is defined strictly by the HTTP/2 specification. Only
// :-prefixed headers defined by that specification may be added to
// this set.
const kValidPseudoHeaders = new SafeSet([
  constants.HTTP2_HEADER_STATUS,
  constants.HTTP2_HEADER_METHOD,
  constants.HTTP2_HEADER_AUTHORITY,
  constants.HTTP2_HEADER_SCHEME,
  constants.HTTP2_HEADER_PATH,
  constants.HTTP2_HEADER_PROTOCOL,
]);

function assertValidPseudoHeader(key) {
  if (!kValidPseudoHeaders.has(key)) {
    throw new ERR_HTTP2_INVALID_PSEUDOHEADER(key);
  }
}
hideFromStack(assertValidPseudoHeader);

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
  const error = new Error(`Stream closed with error code ${nameForErrorCode[code] || code}`);
  error.code = "ERR_HTTP2_STREAM_ERROR";
  error.errno = code;
  return error;
}
hideFromStack(streamErrorFromCode);
function sessionErrorFromCode(code: number) {
  const error = new Error(`Session closed with error code ${nameForErrorCode[code] || code}`);
  error.code = "ERR_HTTP2_SESSION_ERROR";
  error.errno = code;
  return error;
}
hideFromStack(sessionErrorFromCode);

function assertSession(session) {
  if (!session) {
    const error = new Error(`ERR_HTTP2_INVALID_SESSION: The session has been destroyed`);
    error.code = "ERR_HTTP2_INVALID_SESSION";
    throw error;
  }
}
hideFromStack(assertSession);
class Http2Stream extends Duplex {
  #id: number;
  [bunHTTP2Session]: ClientHttp2Session | null = null;
  #endStream: boolean = false;
  [bunHTTP2WantTrailers]: boolean = false;
  [bunHTTP2Closed]: boolean = false;
  rstCode: number | undefined = undefined;
  [bunHTTP2StreamReadQueue]: Array<Buffer> = $createFIFO();
  [bunHTTP2StreamResponded]: boolean = false;
  [bunHTTP2Headers]: any;
  #sentTrailers: any;
  constructor(streamId, session, headers) {
    super();
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
    return session[bunHTTP2Socket]?.bufferSize || 0;
  }

  get sentHeaders() {
    return this[bunHTTP2Headers];
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

    if (headers == undefined) {
      headers = {};
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isJSArray(sensitives)) {
        throw new new ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]")();
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
      const native = session[bunHTTP2Native];
      if (native) {
        native.writeStream(this.#id, chunk, this.#endStream, callback);
        return;
      }
      if (typeof callback == "function") {
        callback();
      }
    }
  }
}
class ClientHttp2Stream extends Http2Stream {
  constructor(streamId, session, headers) {
    super(streamId, session, headers);
  }
}
class ServerHttp2Stream extends Http2Stream {
  constructor(streamId, session, headers) {
    super(streamId, session, headers);
  }
  pushStream() {
    throwNotImplemented("ServerHttp2Stream.prototype.pushStream()");
  }
  respondWithFile(path, headers, options) {
    // TODO: optimize this
    let { statCheck, offset, length, onError } = options || {};
    if (headers == undefined) {
      headers = {};
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    offset = offset || 0;
    const end = length || 0 + offset;
    try {
      const fd = fs.openSync(path, "r");
      if (typeof statCheck === "function") {
        const stat = fs.fstatSync(fd);
        statCheck(stat, headers);
      }

      this.respond(headers, options);
      fs.createReadStream(null, { fd: fd, autoClose: true, start: offset, end, emitClose: true }).pipe(this);
    } catch (err) {
      if (typeof onError === "function") {
        onError(err);
      } else {
        this.close(constants.NGHTTP2_INTERNAL_ERROR, undefined);
      }
    }
  }
  respondWithFD(fd, headers, options) {
    // TODO: optimize this
    let { statCheck, offset, length } = options || {};
    if (headers == undefined) {
      headers = {};
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    offset = offset || 0;
    const end = length || 0 + offset;
    if (typeof statCheck === "function") {
      const stat = fs.fstatSync(fd);
      statCheck(stat, headers);
    }

    this.respond(headers, options);
    fs.createReadStream(null, { fd: fd, autoClose: false, start: offset, end, emitClose: false }).pipe(this);
  }

  respond(headers: any, options?: any) {
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

    if (headers == undefined) {
      headers = {};
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isArray(sensitives)) {
        throw new ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]");
      }
      for (let i = 0; i < sensitives.length; i++) {
        sensitiveNames[sensitives[i]] = true;
      }
    }
    if (headers[":status"] === undefined) {
      headers[":status"] = 200;
    }
    const session = this[bunHTTP2Session];
    assertSession(session);
    if (typeof options === "undefined") {
      session[bunHTTP2Native]?.request(this.id, undefined, headers, sensitiveNames);
    } else {
      session[bunHTTP2Native]?.request(this.id, undefined, headers, sensitiveNames, options);
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

function emitStreamErrorNT(self, stream, error, destroy, destroy_self) {
  if (stream) {
    stream.rstCode = error;
    stream[bunHTTP2Closed] = true;
    stream[bunHTTP2Session] = null;
    const error_instance = streamErrorFromCode(error);
    stream.emit("error", error_instance);
    stream.emit("end");
    stream.emit("close");
    if (destroy) stream.destroy(error_instance, error);
    if (destroy_self) self.destroy();
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

class ServerHttp2Session extends Http2Session {
  #server: Http2Server = null;
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
      self.#parser.setStreamContext(stream_id, stream);
    },
    streamError(self: ServerHttp2Session, stream: ServerHttp2Stream, error: number) {
      if (!self) return;
      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamEnd(self: ServerHttp2Session, stream: ServerHttp2Stream, state: number) {
      if (!self) return;
      if (stream.rstCode === undefined) {
        stream.rstCode = 0;
        stream.emit("end");
      }
      // 7 = closed, in this case we already send everything and received everything
      if (state === 7) {
        stream[bunHTTP2Closed] = true;
        stream[bunHTTP2Session] = null;
        self.#connections--;
        stream.emit("close");
        stream.destroy();
        if (self.#connections === 0 && self.#closed) {
          self.destroy();
        }
      }
    },
    streamData(self: ServerHttp2Session, stream: ServerHttp2Stream, data: Buffer) {
      if (!self) return;
      const queue = stream[bunHTTP2StreamReadQueue];

      if (queue.isEmpty()) {
        if (stream.push(data)) return;
      }
      queue.push(data);
    },
    streamHeaders(
      self: ServerHttp2Session,
      stream: ServerHttp2Stream,
      headers: Record<string, string | string[]>,
      flags: number,
    ) {
      if (!self) return;
      stream[bunHTTP2Headers] = headers;

      let cookie = headers["cookie"];
      if ($isArray(cookie)) {
        headers["cookie"] = (headers["cookie"] as string[]).join(";");
      }
      self.#server.emit("stream", stream, headers, flags);

      if (stream[bunHTTP2StreamResponded]) {
        try {
          stream.emit("trailers", headers, flags);
        } catch {
          process.nextTick(emitStreamErrorNT, self, stream, constants.NGHTTP2_PROTOCOL_ERROR, true, false);
        }
      } else {
        stream[bunHTTP2StreamResponded] = true;
        stream.emit("response", headers, flags);
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
      const error_instance = streamErrorFromCode(errorCode);
      self.emit("error", error_instance);
      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    aborted(self: ServerHttp2Session, stream: ServerHttp2Session, error: any) {
      if (!self) return;

      if (!stream[bunHTTP2Closed]) {
        stream[bunHTTP2Closed] = true;
      }

      stream.rstCode = constants.NGHTTP2_CANCEL;
      stream.emit("aborted");
    },
    wantTrailers(self: ServerHttp2Session, stream: ServerHttp2Session) {
      if (!self) return;

      stream[bunHTTP2WantTrailers] = true;
      stream.emit("wantTrailers");
    },
    goaway(self: ServerHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.emit("goaway", errorCode, lastStreamId, opaqueData || Buffer.allocUnsafe(0));
      if (errorCode !== 0) {
        self.#parser.emitErrorToAllStreams(errorCode);
      }
      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    end(self: ServerHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    write(self: ServerHttp2Session, buffer: Buffer) {
      if (!self) return false;
      const socket = self[bunHTTP2Socket];
      if (!socket) return false;
      if (self.#connected) {
        // redirect writes to socket
        return socket.write(buffer);
      }
      //queue
      self.#queue.push(buffer);
      return true;
    },
  };

  #onRead(data: Buffer) {
    this.#parser?.read(data);
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
    const parser = this.#parser;
    if (parser) {
      for (const stream of parser.getAllStreams()) {
        if (stream) {
          stream.emit("timeout");
        }
      }
    }
    this.emit("timeout");
    this.destroy();
  }

  #onDrain() {
    const parser = this.#parser;
    if (parser) {
      parser.flush();
    }
  }

  constructor(socket: TLSSocket | Socket, options?: Http2ConnectOptions, server: Http2Server) {
    super();
    this.#server = server;
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
    this[bunHTTP2Socket] = socket;
    const nativeSocket = socket[bunSocketInternal];
    this.#encrypted = socket instanceof TLSSocket;

    this.#parser = new H2FrameParser({
      native: nativeSocket,
      context: this,
      settings: options || {},
      type: 0, // server type
      handlers: ServerHttp2Session.#Handlers,
    });
    socket.on("close", this.#onClose.bind(this));
    socket.on("error", this.#onError.bind(this));
    socket.on("timeout", this.#onTimeout.bind(this));
    // we can just use native to read data when possible
    if (!this.#parser.hasNativeRead()) {
      socket.on("data", this.#onRead.bind(this));
      socket.on("drain", this.#onDrain.bind(this));
    }
    process.nextTick(emitConnectNT, this, socket);
  }

  get originSet() {
    if (this.encrypted) {
      return Array.from(this.#originSet);
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
    if (this.#server) return 0;
    return 1;
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
    if (socket) {
      this.goaway(code || constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
      socket.end();
    } else {
      this.#parser?.emitErrorToAllStreams(code || constants.NGHTTP2_NO_ERROR);
    }
    this[bunHTTP2Socket] = null;

    if (error) {
      this.emit("error", error);
    }

    this.emit("close");
  }
}
class ClientHttp2Session extends Http2Session {
  #server: Http2Server = null;
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
        self.#parser.setStreamContext(stream_id, stream);
      }
    },
    streamError(self: ClientHttp2Session, stream: ClientHttp2Stream, error: number) {
      if (!self) return;
      self.#connections--;
      process.nextTick(emitStreamErrorNT, self, stream, error, true, self.#connections === 0 && self.#closed);
    },
    streamEnd(self: ClientHttp2Session, stream: ClientHttp2Stream, state: number) {
      if (!self) return;
      if (stream.rstCode === undefined) {
        stream.rstCode = 0;
        stream.emit("end");
      }
      // 7 = closed, in this case we already send everything and received everything
      if (state === 7) {
        stream[bunHTTP2Closed] = true;
        stream[bunHTTP2Session] = null;
        self.#connections--;
        stream.emit("close");
        stream.destroy();
        if (self.#connections === 0 && self.#closed) {
          self.destroy();
        }
      }
    },
    streamData(self: ClientHttp2Session, stream: ClientHttp2Stream, data: Buffer) {
      if (!self) return;
      const queue = stream[bunHTTP2StreamReadQueue];

      if (queue.isEmpty()) {
        if (stream.push(data)) return;
      }
      queue.push(data);
    },
    streamHeaders(
      self: ClientHttp2Session,
      stream: ClientHttp2Stream,
      headers: Record<string, string | string[]>,
      flags: number,
    ) {
      if (!self) return;
      stream[bunHTTP2Headers] = headers;

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
          process.nextTick(emitStreamErrorNT, self, stream, constants.NGHTTP2_PROTOCOL_ERROR, true, false);
        }
      } else {
        stream[bunHTTP2StreamResponded] = true;
        stream.emit("response", headers, flags);
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
      const error_instance = streamErrorFromCode(errorCode);
      self.emit("error", error_instance);
      self[bunHTTP2Socket]?.end();
      self[bunHTTP2Socket] = null;
      self.#parser = null;
    },
    aborted(self: ClientHttp2Session, stream: ClientHttp2Stream, error: any) {
      if (!self) return;

      if (!stream[bunHTTP2Closed]) {
        stream[bunHTTP2Closed] = true;
      }

      stream.rstCode = constants.NGHTTP2_CANCEL;
      stream.emit("aborted", error);
    },
    wantTrailers(self: ClientHttp2Session, stream: ClientHttp2Stream) {
      if (!self) return;

      stream[bunHTTP2WantTrailers] = true;
      stream.emit("wantTrailers");
    },
    goaway(self: ClientHttp2Session, errorCode: number, lastStreamId: number, opaqueData: Buffer) {
      if (!self) return;
      self.emit("goaway", errorCode, lastStreamId, opaqueData || Buffer.allocUnsafe(0));
      if (errorCode !== 0) {
        self.#parser.emitErrorToAllStreams(errorCode);
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
      if (!self) return false;
      const socket = self[bunHTTP2Socket];
      if (!socket) return false;
      if (self.#connected) {
        // redirect writes to socket
        return socket.write(buffer);
      }
      //queue
      self.#queue.push(buffer);
      return false;
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
    const nativeSocket = socket[bunSocketInternal];
    if (nativeSocket) {
      this.#parser.setNativeSocket(nativeSocket);
    }
    // we can just use native to read data when possible
    if (!this.#parser.hasNativeRead()) {
      socket.on("data", this.#onRead.bind(this));
      socket.on("drain", this.#onDrain.bind(this));
    }
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
    const parser = this.#parser;
    if (parser) {
      for (const stream of parser.getAllStreams()) {
        if (stream) {
          stream.emit("timeout");
        }
      }
    }
    this.emit("timeout");
    this.destroy();
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
    if (this.#server) return 0;
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
              ALPNProtocols: ["h2"],
              ...options,
            }
          : {
              host: url.hostname,
              port,
              ALPNProtocols: ["h2"],
            },
        onConnect.bind(this),
      );
      this[bunHTTP2Socket] = socket;
    }
    this.#encrypted = socket instanceof TLSSocket;
    const nativeSocket = socket[bunSocketInternal];
    this.#parser = new H2FrameParser({
      native: nativeSocket,
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
    if (socket) {
      this.goaway(code || constants.NGHTTP2_NO_ERROR, 0, Buffer.alloc(0));
      socket.end();
    } else {
      this.#parser?.emitErrorToAllStreams(code || constants.NGHTTP2_NO_ERROR);
    }
    this[bunHTTP2Socket] = null;

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

    if (headers == undefined) {
      headers = {};
    }

    if (!$isObject(headers)) {
      throw new Error("ERR_HTTP2_INVALID_HEADERS: headers must be an object");
    }

    const sensitives = headers[sensitiveHeaders];
    const sensitiveNames = {};
    if (sensitives) {
      if (!$isArray(sensitives)) {
        throw new ERR_INVALID_ARG_VALUE("headers[http2.neverIndex]");
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
    if (headers[":path"] == undefined) {
      headers[":path"] = "/";
    }

    if (NoPayloadMethods.has(method.toUpperCase())) {
      options = options || {};
      options.endStream = true;
    }
    let stream_id: number = this.#parser.getNextStream();
    const req = new ClientHttp2Stream(stream_id, this, headers);
    req.authority = authority;
    if (stream_id < 0) {
      const error = new Error(
        "ERR_HTTP2_OUT_OF_STREAMS: No stream ID is available because maximum stream ID has been reached",
      );
      error.code = "ERR_HTTP2_OUT_OF_STREAMS";
      this.emit("error", error);
      return null;
    }
    if (typeof options === "undefined") {
      this.#parser.request(stream_id, req, headers, sensitiveNames);
    } else {
      this.#parser.request(stream_id, req, headers, sensitiveNames, options);
    }
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

function setupCompat(ev) {
  if (ev === "request") {
    this.removeListener("newListener", setupCompat);
    this.on("stream", FunctionPrototypeBind(onServerStream, this));
  }
}
class Http2Server extends net.Server {
  static #connectionListener(socket: Socket) {
    const session = new ServerHttp2Session(socket, this[bunSocketServerOptions], this);
    this.emit("session", session);
  }
  constructor(options, onRequestHandler) {
    if (typeof options === "function") {
      onRequestHandler = options;
      options = {};
    } else if (options == null || typeof options == "object") {
      options = { ...options };
    } else {
      throw new TypeError("ERR_INVALID_ARG_TYPE: options must be an object");
    }
    super(options);
    this.on("newListener", setupCompat);
    this.on("connection", Http2Server.#connectionListener);
    if (typeof onRequestHandler === "function") {
      this.on("request", onRequestHandler);
    }
  }
  setTimeout(ms, callback) {
    this[bunSocketInternal]?.setTimeout(ms, callback);
  }
  updateSettings(settings) {}
}
class Http2SecureServer extends tls.Server {
  static #connectionListener(socket: TLSSocket | Socket) {
    const session = new ServerHttp2Session(socket, this[bunSocketServerOptions], this);
    this.emit("session", session);
  }
  constructor(options, onRequestHandler) {
    if (typeof options === "function") {
      onRequestHandler = options;
      options = { ALPNProtocols: ["h2"] };
    } else if (options == null || typeof options == "object") {
      options = { ...options, ALPNProtocols: ["h2"] };
    } else {
      throw new TypeError("ERR_INVALID_ARG_TYPE: options must be an object");
    }
    super(options);
    this.on("newListener", setupCompat);
    this.on("secureConnection", Http2SecureServer.#connectionListener);
    if (typeof onRequestHandler === "function") {
      this.on("request", onRequestHandler);
    }
  }
  setTimeout(ms, callback) {
    this[bunSocketInternal]?.setTimeout(ms, callback);
  }
  updateSettings(settings) {}
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
