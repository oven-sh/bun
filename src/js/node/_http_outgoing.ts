const { Stream } = require("internal/stream");
const { validateFunction } = require("internal/validators");

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

const { validateHeaderName, validateHeaderValue } = require("node:_http_common");

const { FakeSocket } = require("internal/http/FakeSocket");

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
    if ((this._header !== undefined && this._header !== null) || this[headerStateSymbol] === NodeHTTPHeaderState.sent) {
      throw $ERR_HTTP_HEADERS_SENT("remove");
    }
    const headers = this[headersSymbol];
    if (!headers) return;
    headers.delete(name);
  },

  setHeader(name, value) {
    if ((this._header !== undefined && this._header !== null) || this[headerStateSymbol] === NodeHTTPHeaderState.sent) {
      throw $ERR_HTTP_HEADERS_SENT("set");
    }
    validateHeaderName(name);
    validateHeaderValue(name, value);
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

  addTrailers(_headers) {
    throw new Error("not implemented");
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
