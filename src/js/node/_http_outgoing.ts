const { Stream } = require("internal/stream");
const { isUint8Array, validateString } = require("internal/validators");
const { deprecate } = require("internal/util/deprecate");
const ObjectDefineProperty = Object.defineProperty;
const ObjectKeys = Object.keys;
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
  kHandle,
  getHeader,
  setHeader,
  Headers,
  getRawKeys,
  kOutHeaders,
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
  } else {
    len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
    msg[kBytesWritten] += len;
  }

  function connectionUnCorkNT(conn) {
    conn.uncork();
  }
  let lazyCrlfBuf;
  function getCrlfBuf() {
    if (!lazyCrlfBuf) {
      lazyCrlfBuf = Buffer.from("\r\n");
    }
    return lazyCrlfBuf;
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
    process.nextTick(connectionUnCorkNT, msg.socket);
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
  this[kBytesWritten] = 0;
  this.writable = true;
  this.destroyed = false;
  this._hasBody = true;
  this._trailer = "";
  this._contentLength = null;
  this._closed = false;
  this._header = null;
  this._headerSent = false;
  this[kHighWaterMark] = options?.highWaterMark ?? (process.platform === "win32" ? 16 * 1024 : 64 * 1024);
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
  _headerNames: undefined,
  appendHeader(name, value) {
    validateString(name, "name");
    var headers = (this[headersSymbol] ??= new Headers());
    headers.append(name, value);
    return this;
  },

  _implicitHeader() {
    throw $ERR_METHOD_NOT_IMPLEMENTED("_implicitHeader()");
  },
  flushHeaders() {},
  getHeader(name) {
    validateString(name, "name");
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

  pipe() {
    // OutgoingMessage should be write-only. Piping from it is disabled.
    this.emit("error", $ERR_STREAM_CANNOT_PIPE());
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
    validateString(name, "name");
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
    validateString(name, "name");
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
    if (this.callback) {
      this.emit("timeout", callback);
    }

    if (!this[fakeSocketSymbol]) {
      this.once("socket", function socketSetTimeoutOnConnect(socket) {
        socket.setTimeout(msecs, callback);
      });
    } else {
      this.socket.setTimeout(msecs);
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
    return this.finished ? 0 : this[kBytesWritten] || 0;
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

  // _send(data, encoding, callback, _byteLength) {
  // if (this.destroyed) {
  //   return false;
  // }
  // return this.write(data, encoding, callback);
  // },
  _send(data, encoding, callback, byteLength) {
    // This is a shameful hack to get the headers and first body chunk onto
    // the same packet. Future versions of Node are going to take care of
    // this at a lower level and in a more general way.
    if (!this._headerSent && this._header !== null) {
      // `this._header` can be null if OutgoingMessage is used without a proper Socket
      // See: /test/parallel/test-http-outgoing-message-inheritance.js
      if (typeof data === "string" && (encoding === "utf8" || encoding === "latin1" || !encoding)) {
        data = this._header + data;
      } else {
        const header = this._header;
        this.outputData.unshift({
          data: header,
          encoding: "latin1",
          callback: null,
        });
        this.outputSize += header.length;
        this._onPendingData(header.length);
      }
      this._headerSent = true;
    }
    return this._writeRaw(data, encoding, callback, byteLength);
  },
  _writeRaw(data, encoding, callback, _size) {
    const conn = this[kHandle];
    if (conn?.destroyed) {
      // The socket was destroyed. If we're still trying to write to it,
      // then we haven't gotten the 'close' event yet.
      return false;
    }

    if (typeof encoding === "function") {
      callback = encoding;
      encoding = null;
    }

    if (conn && conn._httpMessage === this && conn.writable) {
      // There might be pending data in the this.output buffer.
      if (this.outputData.length) {
        this._flushOutput(conn);
      }
      // Directly write to socket.
      return conn.write(data, encoding, callback);
    }
    // Buffer, as long as we're not destroyed.
    this.outputData.push({ data, encoding, callback });
    this.outputSize += data.length;
    this._onPendingData(data.length);
    return this.outputSize < this[kHighWaterMark];
  },

  end(_chunk, _encoding, _callback) {
    return this;
  },
  get writableCorked() {
    return this.socket.writableCorked;
  },
  set writableCorked(value) {},
  cork() {
    this.socket.cork();
  },
  uncork() {
    this.socket.uncork();
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
ObjectDefineProperty(OutgoingMessage.prototype, "_headerNames", {
  __proto__: null,
  get: deprecate(
    function () {
      const headers = this.getHeaders();
      if (headers !== null) {
        const out = Object.create(null);
        const keys = ObjectKeys(headers);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; ++i) {
          const key = keys[i];
          out[key] = key;
        }
        return out;
      }
      return null;
    },
    "OutgoingMessage.prototype._headerNames is deprecated",
    "DEP0066",
  ),
  set: deprecate(
    function (val) {
      if (typeof val === "object" && val !== null) {
        const headers = this.getHeaders();
        if (!headers) return;
        const keys = ObjectKeys(val);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; ++i) {
          const header = headers[keys[i]];
          if (header) header[keys[i]] = val[keys[i]];
        }
      }
    },
    "OutgoingMessage.prototype._headerNames is deprecated",
    "DEP0066",
  ),
});
ObjectDefineProperty(OutgoingMessage.prototype, "_headers", {
  __proto__: null,
  get: deprecate(
    function () {
      return this.getHeaders();
    },
    "OutgoingMessage.prototype._headers is deprecated",
    "DEP0066",
  ),
  set: deprecate(
    function (val) {
      if (val == null) {
        this[kOutHeaders] = null;
      } else if (typeof val === "object") {
        const headers = (this[kOutHeaders] = Object.create(null));
        const keys = ObjectKeys(val);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; ++i) {
          const name = keys[i];
          headers[name.toLowerCase()] = [name, val[name]];
        }
      }
    },
    "OutgoingMessage.prototype._headers is deprecated",
    "DEP0066",
  ),
});
$setPrototypeDirect.$call(OutgoingMessage, Stream);

export default {
  OutgoingMessage,
  FakeSocket,
  OutgoingMessagePrototype,
};
