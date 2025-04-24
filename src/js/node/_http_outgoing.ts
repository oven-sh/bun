const { Stream } = require("internal/stream");
const { validateFunction, isUint8Array } = require("internal/validators");

const {
  headerStateSymbol,
  NodeHTTPHeaderState,
  kAbortController,
  fakeSocketSymbol,
  headersSymbol,
  kBodyChunks,
  kEmitState,
  ClientRequestEmitState,
  kEmptyObject,
  validateMsecs,
  hasServerResponseFinished,
  timeoutTimerSymbol,
  kHandle,
  getHeader,
  setHeader,
  Headers,
  getRawKeys,
} = require("internal/http");

const {
  validateHeaderName,
  validateHeaderValue,
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
} = require("node:_http_common");
const kUniqueHeaders = Symbol("kUniqueHeaders");
const kBytesWritten = Symbol("kBytesWritten");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const kCorked = Symbol("corked");
const kChunkedBuffer = Symbol("kChunkedBuffer");
const kHighWaterMark = Symbol("kHighWaterMark");
const kChunkedLength = Symbol("kChunkedLength");
const { FakeSocket } = require("internal/http/FakeSocket");
const nop = () => {};

function emitErrorNt(msg, err, callback) {
  callback(err);
  if (typeof msg.emit === "function" && !msg.destroyed) {
    msg.emit("error", err);
  }
}

function onError(msg, err, callback) {
  if (msg.destroyed) {
    return;
  }

  process.nextTick(emitErrorNt, msg, err, callback);
}

function write_(msg, chunk, encoding, callback, fromEnd) {
  if (typeof callback !== "function") callback = nop;

  if (chunk === null) {
    throw $ERR_STREAM_NULL_VALUES();
  } else if (typeof chunk !== "string" && !isUint8Array(chunk)) {
    throw $ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
  }

  let err;
  if (msg.finished) {
    err = $ERR_STREAM_WRITE_AFTER_END();
  } else if (msg.destroyed) {
    err = $ERR_STREAM_DESTROYED("write");
  }

  if (err) {
    if (!msg.destroyed) {
      onError(msg, err, callback);
    } else {
      process.nextTick(callback, err);
    }
    return false;
  }

  let len;

  if (msg.strictContentLength) {
    len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;

    if (
      strictContentLength(msg) &&
      (fromEnd ? msg[kBytesWritten] + len !== msg._contentLength : msg[kBytesWritten] + len > msg._contentLength)
    ) {
      const err = new Error(
        `Response body's content-length of ${len + msg[kBytesWritten]} byte(s) does not match the content-length of ${msg._contentLength} byte(s) set in header`,
      );

      throw err;
    }

    msg[kBytesWritten] += len;
  }

  function connectionCorkNT(conn) {
    conn.uncork();
  }
  let __crlf_buf;
  function getCrlfBuf() {
    if (!__crlf_buf) {
      __crlf_buf = Buffer.from("\r\n");
    }
    return __crlf_buf;
  }
  function strictContentLength(msg) {
    return (
      msg.strictContentLength &&
      msg._contentLength != null &&
      msg._hasBody &&
      !msg._removedContLen &&
      !msg.chunkedEncoding &&
      !msg.hasHeader("transfer-encoding")
    );
  }

  if (!msg._header) {
    if (fromEnd) {
      len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
      msg._contentLength = len;
    }
    msg._implicitHeader();
  }

  if (!msg._hasBody) {
    if (msg[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      process.nextTick(callback);
      return true;
    }
  }

  if (!fromEnd && msg.socket && !msg.socket.writableCorked) {
    msg.socket.cork();
    process.nextTick(connectionCorkNT, msg.socket);
  }

  let ret;
  if (msg.chunkedEncoding && chunk.length !== 0) {
    len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
    if (msg[kCorked] && msg._headerSent) {
      msg[kChunkedBuffer].push(chunk, encoding, callback);
      msg[kChunkedLength] += len;
      ret = msg[kChunkedLength] < msg[kHighWaterMark];
    } else {
      const crlf_buf = getCrlfBuf();
      msg._send(len.toString(16), "latin1", null);
      msg._send(crlf_buf, null, null);
      msg._send(chunk, encoding, null, len);
      ret = msg._send(crlf_buf, null, callback);
    }
  } else {
    ret = msg._send(chunk, encoding, callback, len);
  }

  return ret;
}

function OutgoingMessage(options) {
  if (!new.target) {
    return new OutgoingMessage(options);
  }

  Stream.$call(this, options);

  this.sendDate = true;
  this.finished = false;
  this[headerStateSymbol] = NodeHTTPHeaderState.none;
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
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = null;
    }

    return write_(this, chunk, encoding, callback, false);
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
    if ((this._header !== undefined && this._header !== null) || this[headerStateSymbol] === NodeHTTPHeaderState.sent) {
      throw $ERR_HTTP_HEADERS_SENT("remove");
    }
    const headers = this[headersSymbol];
    if (!headers) return;
    headers.delete(name);
  },

  setHeader(name, value) {
    if ((this._header !== undefined && this._header !== null) || this[headerStateSymbol] == NodeHTTPHeaderState.sent) {
      throw $ERR_HTTP_HEADERS_SENT("set");
    }
    validateHeaderName(name);
    validateHeaderValue(name, value);
    const headers = (this[headersSymbol] ??= new Headers());
    setHeader(headers, name, value);
    return this;
  },
  setHeaders(headers) {
    if (this._header || this[headerStateSymbol] !== NodeHTTPHeaderState.none) {
      throw $ERR_HTTP_HEADERS_SENT("set");
    }

    if (!headers || $isArray(headers) || typeof headers.keys !== "function" || typeof headers.get !== "function") {
      throw $ERR_INVALID_ARG_TYPE("headers", ["Headers", "Map"], headers);
    }

    // Headers object joins multiple cookies with a comma when using
    // the getter to retrieve the value,
    // unless iterating over the headers directly.
    // We also cannot safely split by comma.
    // To avoid setHeader overwriting the previous value we push
    // set-cookie values in array and set them all at once.
    const cookies = [];

    for (const { 0: key, 1: value } of headers) {
      if (key === "set-cookie") {
        if ($isArray(value)) {
          cookies.push(...value);
        } else {
          cookies.push(value);
        }
        continue;
      }
      this.setHeader(key, value);
    }
    if (cookies.length) {
      this.setHeader("set-cookie", cookies);
    }

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
    this._trailer = "";
    const keys = Object.keys(headers);
    const isArray = $isArray(headers);
    // Retain for(;;) loop for performance reasons
    // Refs: https://github.com/nodejs/node/pull/30958
    for (let i = 0, l = keys.length; i < l; i++) {
      let field, value;
      const key = keys[i];
      if (isArray) {
        field = headers[key][0];
        value = headers[key][1];
      } else {
        field = key;
        value = headers[key];
      }
      validateHeaderName(field, "Trailer name");

      // Check if the field must be sent several times
      const isArrayValue = $isArray(value);
      if (
        isArrayValue &&
        value.length > 1 &&
        (!this[kUniqueHeaders] || !this[kUniqueHeaders].has(field.toLowerCase()))
      ) {
        for (let j = 0, l = value.length; j < l; j++) {
          if (checkInvalidHeaderChar(value[j])) {
            throw $ERR_INVALID_CHAR("trailer content", field);
          }
          this._trailer += field + ": " + value[j] + "\r\n";
        }
      } else {
        if (isArrayValue) {
          value = value.join("; ");
        }

        if (checkInvalidHeaderChar(value)) {
          throw $ERR_INVALID_CHAR("trailer content", field);
        }
        this._trailer += field + ": " + value + "\r\n";
      }
    }
  },

  setTimeout(msecs, callback) {
    if (this.destroyed) return this;

    this.timeout = msecs = validateMsecs(msecs, "timeout");

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
  set connection(value) {
    this.socket = value;
  },

  get socket() {
    this[fakeSocketSymbol] = this[fakeSocketSymbol] ?? new FakeSocket(this);
    return this[fakeSocketSymbol];
  },

  set socket(value) {
    this[fakeSocketSymbol] = value;
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

  _send(data, encoding, callback, _byteLength) {
    if (this.destroyed) {
      return false;
    }
    return this.write(data, encoding, callback);
  },
  end(_chunk, _encoding, _callback) {
    return this;
  },
  destroy(_err?: Error) {
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

export default {
  OutgoingMessage,
  FakeSocket,
  OutgoingMessagePrototype,
};
