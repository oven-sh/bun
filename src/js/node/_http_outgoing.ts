import { 
  getHeader,
  hasServerResponseFinished,
  headersSymbol,
  kAbortController,
  kEmptyObject,
  kFakeSocket,
  kHandle,
  kHeaderState,
  NodeHTTPHeaderState,
  setHeader,
  timeoutTimerSymbol,
  FakeSocket,
  kEmitState,
  ClientRequestEmitState,
  kBodyChunks,
  validateMsecs,
} from "internal/http/share";
import Stream from "node:stream";

const kUniqueHeaders = Symbol('kUniqueHeaders');
const kHighWaterMark = Symbol('kHighWaterMark');

const {
  validateFunction,
  checkIsHttpToken,
  // validateLinkHeaderValue,
  // validateObject,
  // validateInteger,
} = require("internal/validators");

const getRawKeys = $newCppFunction("JSFetchHeaders.cpp", "jsFetchHeaders_getRawKeys", 0);

const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
const RegExpPrototypeExec = RegExp.prototype.exec;
/**
 * True if val contains an invalid field-vchar
 *  field-value    = *( field-content / obs-fold )
 *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 *  field-vchar    = VCHAR / obs-text
 */
function checkInvalidHeaderChar(val: string) {
  return RegExpPrototypeExec.$call(headerCharRegex, val) !== null;
}

const validateHeaderName = (name, label?) => {
  if (typeof name !== "string" || !name || !checkIsHttpToken(name)) {
    throw $ERR_INVALID_HTTP_TOKEN(label || "Header name", name);
  }
};

const validateHeaderValue = (name, value) => {
  if (value === undefined) {
    throw $ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(value)) {
    throw $ERR_INVALID_CHAR("header content", name);
  }
};

function OutgoingMessage(options): void {
  if (!new.target)
    return new OutgoingMessage(options);

  Stream.$call(this, options);

  this.sendDate = true;
  this.finished = false;
  this[kHeaderState] = NodeHTTPHeaderState.none;
  this[kAbortController] = null;

  this.writable = true;
  this.destroyed = false;
  this._hasBody = true;
  this._trailer = "";
  this._contentLength = null;
  this._closed = false;
  this._header = null;
  this._headerSent = false;
}

const OutgoingMessagePrototype = {
  constructor: OutgoingMessage,
  __proto__: Stream.prototype,

  // These are fields which we do not use in our implementation, but are observable in Node.js.
  _keepAliveTimeout: 0,
  _defaultKeepAlive: true,
  shouldKeepAlive: true,
  _onPendingData: function nop() {},
  outputSize: 0,
  outputData: [],
  strictContentLength: false,
  _removedTE: false,
  _removedContLen: false,
  _removedConnection: false,
  usesChunkedEncodingByDefault: true,
  _closed: false,

  appendHeader(name, value) {
    var headers = (this[headersSymbol] ??= new Headers());
    headers.append(name, value);
    return this;
  },

  _implicitHeader() {
    throw $ERR_METHOD_NOT_IMPLEMENTED("_implicitHeader()");
  },
  flushHeaders() {},
  getHeader(name) {
    return getHeader(this[headersSymbol], name);
  },

  // Overridden by ClientRequest and ServerResponse; this version will be called only if the user constructs OutgoingMessage directly.
  write(chunk, encoding, callback) {
    if ($isCallable(chunk)) {
      callback = chunk;
      chunk = undefined;
    } else if ($isCallable(encoding)) {
      callback = encoding;
      encoding = undefined;
    } else if (!$isCallable(callback)) {
      callback = undefined;
      encoding = undefined;
    }
    hasServerResponseFinished(this, chunk, callback);
    if (chunk) {
      const len = Buffer.byteLength(chunk, encoding || (typeof chunk === "string" ? "utf8" : "buffer"));
      if (len > 0) {
        this.outputSize += len;
        this.outputData.push(chunk);
      }
    }
    return this.writableHighWaterMark >= this.outputSize;
  },

  getHeaderNames() {
    var headers = this[headersSymbol];
    if (!headers) return [];
    return Array.from(headers.keys());
  },

  getRawHeaderNames() {
    var headers = this[headersSymbol];
    if (!headers) return [];
    return getRawKeys.$call(headers);
  },

  getHeaders() {
    const headers = this[headersSymbol];
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  },

  removeHeader(name) {
    if (this[kHeaderState] === NodeHTTPHeaderState.sent) {
      throw $ERR_HTTP_HEADERS_SENT("remove");
    }
    const headers = this[headersSymbol];
    if (!headers) return;
    headers.delete(name);
  },

  setHeader(name, value) {
    validateHeaderName(name);
    const headers = (this[headersSymbol] ??= new Headers());
    setHeader(headers, name, value);
    return this;
  },

  hasHeader(name) {
    const headers = this[headersSymbol];
    if (!headers) return false;
    return headers.has(name);
  },

  get headers() {
    const headers = this[headersSymbol];
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  },
  set headers(value) {
    this[headersSymbol] = new Headers(value);
  },

  addTrailers(headers) {
    throw new Error("not implemented");
  },

  setTimeout(msecs, callback) {
    if (this.destroyed) return this;

    this.timeout = msecs = validateMsecs(msecs, "msecs");

    // Attempt to clear an existing timer in both cases -
    //  even if it will be rescheduled we don't want to leak an existing timer.
    clearTimeout(this[timeoutTimerSymbol]);

    if (msecs === 0) {
      if (callback != null) {
        if (!$isCallable(callback)) validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }

      this[timeoutTimerSymbol] = undefined;
    } else {
      this[timeoutTimerSymbol] = setTimeout(onTimeout.bind(this), msecs).unref();

      if (callback != null) {
        if (!$isCallable(callback)) validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }

    return this;
  },

  get connection() {
    return this.socket;
  },

  get socket() {
    this[kFakeSocket] = this[kFakeSocket] ?? new FakeSocket();
    return this[kFakeSocket];
  },

  set socket(value) {
    this[kFakeSocket] = value;
  },

  get chunkedEncoding() {
    return false;
  },

  set chunkedEncoding(value) {
    // noop
  },

  get writableObjectMode() {
    return false;
  },

  get writableLength() {
    return 0;
  },

  get writableHighWaterMark() {
    return 16 * 1024;
  },

  get writableNeedDrain() {
    return !this.destroyed && !this.finished && this[kBodyChunks] && this[kBodyChunks].length > 0;
  },

  get writableEnded() {
    return this.finished;
  },

  get writableFinished() {
    return this.finished && !!(this[kEmitState] & (1 << ClientRequestEmitState.finish));
  },

  _send(data, encoding, callback, byteLength) {
    if (this.destroyed) {
      return false;
    }
    return this.write(data, encoding, callback);
  },
  end(chunk, encoding, callback) {
    return this;
  },
  destroy(err?: Error) {
    if (this.destroyed) return this;
    const handle = this[kHandle];
    this.destroyed = true;
    if (handle) {
      handle.abort();
    }
    return this;
  },
};
OutgoingMessage.prototype = OutgoingMessagePrototype;
$setPrototypeDirect.$call(OutgoingMessage, Stream);

function onTimeout() {
  this[timeoutTimerSymbol] = undefined;
  this[kAbortController]?.abort();
  const handle = this[kHandle];

  this.emit("timeout");
  if (handle) {
    handle.abort();
  }
}

function parseUniqueHeadersOption(headers: any) {
  if (!$isJSArray(headers)) {
    return null;
  }

  const unique = new Set();
  const l = headers.length;
  for (let i = 0; i < l; i++) {
    unique.$add(headers[i].toLowerCase());
  }

  return unique;
}

export {
  kHighWaterMark,
  kUniqueHeaders,
  parseUniqueHeadersOption,
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage,
};
