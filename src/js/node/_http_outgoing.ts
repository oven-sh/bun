// Hardcoded module "node:_http_outgoing"
// This is a port of Node.js's lib/_http_outgoing.js
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js
const { Stream } = require("internal/stream");
const { isUint8Array, validateString } = require("internal/validators");
const { deprecate } = require("internal/util/deprecate");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const { kOutHeaders, kNeedDrain, utcDate } = require("internal/http");
const {
  validateHeaderName,
  validateHeaderValue,
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression: RE_TE_CHUNKED,
  isLenient,
} = require("node:_http_common");
const { FakeSocket } = require("internal/http/FakeSocket");
const EE = require("node:events");

const ObjectDefineProperty = Object.defineProperty;
const ObjectKeys = Object.keys;
const ObjectValues = Object.values;
const ObjectHasOwn = Object.hasOwn;
const ArrayIsArray = Array.isArray;
const MathFloor = Math.floor;

// kOutHeaders is keyed by the lowercased header name, so every setHeader /
// getHeader / hasHeader / removeHeader lowercases its argument. For the
// conventionally-cased spellings frameworks actually pass ("Content-Type",
// "ETag", ...) toLowerCase() allocates a new string on every call, which the
// property access then has to intern. Map those spellings to a literal that is
// already interned; anything else still takes toLowerCase(). Same result, no
// allocation on the common path.
const commonLowercasedHeaders = { __proto__: null };
for (const name of [
  "accept",
  "accept-encoding",
  "accept-language",
  "accept-ranges",
  "access-control-allow-origin",
  "age",
  "cache-control",
  "connection",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "cookie",
  "date",
  "etag",
  "expires",
  "host",
  "last-modified",
  "location",
  "pragma",
  "server",
  "set-cookie",
  "transfer-encoding",
  "user-agent",
  "vary",
  "x-content-type-options",
  "x-forwarded-for",
  "x-powered-by",
  "x-requested-with",
]) {
  commonLowercasedHeaders[name] = name;
  // The Http-Header-Case spelling, which is what callers overwhelmingly pass.
  let titled = "";
  for (const part of name.split("-")) titled += (titled ? "-" : "") + part.charAt(0).toUpperCase() + part.slice(1);
  commonLowercasedHeaders[titled] = name;
}
// Spellings that title-casing does not produce.
commonLowercasedHeaders["ETag"] = "etag";
commonLowercasedHeaders["etag"] = "etag";

function lowercaseHeaderName(name) {
  const known = commonLowercasedHeaders[name];
  return known !== undefined ? known : name.toLowerCase();
}

const kCorked = Symbol("corked");
const kSocket = Symbol("kSocket");
const kChunkedBuffer = Symbol("kChunkedBuffer");
const kChunkedLength = Symbol("kChunkedLength");
const kUniqueHeaders = Symbol("kUniqueHeaders");
const kBytesWritten = Symbol("kBytesWritten");
const kErrored = Symbol("errored");
const kHighWaterMark = Symbol("kHighWaterMark");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const kLenientValidation = Symbol("kLenientValidation");

const nop = () => {};

const RE_CONN_CLOSE = /(?:^|\W)close(?:$|\W)/i;

// isCookieField performs a case-insensitive comparison of a provided string
// against the word "cookie." As of V8 6.6 this is faster than handrolling or
// using a case-insensitive RegExp.
function isCookieField(s) {
  return s.length === 6 && s.toLowerCase() === "cookie";
}

function isContentDispositionField(s) {
  return s.length === 19 && s.toLowerCase() === "content-disposition";
}

function OutgoingMessage(options) {
  Stream.$call(this, options);

  // Queue that holds all currently pending data, until the response will be
  // assigned to the socket (until it will its turn in the HTTP pipeline).
  this.outputData = [];

  // `outputSize` is an approximate measure of how much data is queued on this
  // response. `_onPendingData` will be invoked to update similar global
  // per-connection counter. That counter will be used to pause/unpause the
  // TCP socket and HTTP Parser and thus handle the backpressure.
  this.outputSize = 0;

  this.writable = true;
  this.destroyed = false;

  this._last = false;
  this.chunkedEncoding = false;
  this.shouldKeepAlive = true;
  this.maxRequestsOnConnectionReached = false;
  this._defaultKeepAlive = true;
  this.useChunkedEncodingByDefault = true;
  this.sendDate = false;
  this._removedConnection = false;
  this._removedContLen = false;
  this._removedTE = false;

  this.strictContentLength = false;
  this[kBytesWritten] = 0;
  this._contentLength = null;
  this._hasBody = true;
  this._trailer = "";
  this[kNeedDrain] = false;

  this.finished = false;
  this._headerSent = false;
  this[kCorked] = 0;
  this[kChunkedBuffer] = [];
  this[kChunkedLength] = 0;
  this._closed = false;

  this[kSocket] = null;
  this._header = null;
  this[kOutHeaders] = null;

  this._keepAliveTimeout = 0;

  this._onPendingData = nop;

  this[kErrored] = null;
  this[kHighWaterMark] = options?.highWaterMark ?? getDefaultHighWaterMark();
  this[kRejectNonStandardBodyWrites] = options?.rejectNonStandardBodyWrites ?? false;
  // Declared here so the memoizing _isLenientHeaderValidation never
  // shape-transitions the message when it caches.
  this[kLenientValidation] = undefined;
}
$toClass(OutgoingMessage, "OutgoingMessage", Stream);

// Check if lenient header validation should be used.
// For ClientRequest: checks this.httpValidation or this.insecureHTTPParser
// For ServerResponse: checks the server's httpValidation or insecureHTTPParser
// Falls back to global --insecure-http-parser flag.
// Every input is fixed for the life of the message, but setHeader and
// appendHeader consult this once per header: compute once, cache in the
// constructor-declared slot.
OutgoingMessage.prototype._isLenientHeaderValidation = function () {
  const cached = this[kLenientValidation];
  if (cached !== undefined) return cached;

  let result;
  // New httpValidation option takes priority (ClientRequest case)
  const httpValidation = this.httpValidation;
  if (httpValidation !== undefined) {
    result = httpValidation !== "strict";
  } else {
    // ServerResponse routes both options through the owning server; walk the
    // req -> socket -> server chain once, not once per option.
    const server = this.req?.socket?.server;
    const serverHttpValidation = server?.httpValidation;
    if (serverHttpValidation !== undefined) {
      result = serverHttpValidation !== "strict";
    } else {
      // Legacy insecureHTTPParser - ClientRequest has it directly
      const insecureHTTPParser = this.insecureHTTPParser;
      if (typeof insecureHTTPParser === "boolean") {
        result = insecureHTTPParser;
      } else {
        // ServerResponse can access via the server
        const serverOption = server?.insecureHTTPParser;
        result = typeof serverOption === "boolean" ? serverOption : isLenient();
      }
    }
  }
  return (this[kLenientValidation] = result);
};

ObjectDefineProperty(OutgoingMessage.prototype, "errored", {
  __proto__: null,
  get() {
    return this[kErrored];
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "closed", {
  __proto__: null,
  get() {
    return this._closed;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableFinished", {
  __proto__: null,
  get() {
    return this.finished && this.outputSize === 0 && (!this[kSocket] || this[kSocket].writableLength === 0);
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableObjectMode", {
  __proto__: null,
  get() {
    return false;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableLength", {
  __proto__: null,
  get() {
    return this.outputSize + this[kChunkedLength] + (this[kSocket] ? this[kSocket].writableLength : 0);
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableHighWaterMark", {
  __proto__: null,
  get() {
    return this[kSocket] ? this[kSocket].writableHighWaterMark : this[kHighWaterMark];
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableCorked", {
  __proto__: null,
  get() {
    return this[kCorked];
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "connection", {
  __proto__: null,
  get: function () {
    return this[kSocket];
  },
  set: function (val) {
    this.socket = val;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "socket", {
  __proto__: null,
  get: function () {
    return this[kSocket];
  },
  set: function (val) {
    for (let n = 0; n < this[kCorked]; n++) {
      val?.cork();
      this[kSocket]?.uncork();
    }
    this[kSocket] = val;
  },
});

OutgoingMessage.prototype._renderHeaders = function _renderHeaders() {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("render");
  }

  const headersMap = this[kOutHeaders];
  const headers = {};

  if (headersMap !== null) {
    const keys = ObjectKeys(headersMap);
    // Retain for(;;) loop for performance reasons
    // Refs: https://github.com/nodejs/node/pull/30958
    for (let i = 0, l = keys.length; i < l; i++) {
      const key = keys[i];
      headers[headersMap[key][0]] = headersMap[key][1];
    }
  }
  return headers;
};

OutgoingMessage.prototype.cork = function cork() {
  this[kCorked]++;
  if (this[kSocket]) {
    this[kSocket].cork();
  }
};

OutgoingMessage.prototype.uncork = function uncork() {
  this[kCorked]--;
  if (this[kSocket]) {
    this[kSocket].uncork();
  }

  if (this[kCorked] || this[kChunkedBuffer].length === 0) {
    return;
  }

  const len = this[kChunkedLength];
  const buf = this[kChunkedBuffer];

  $assert(this.chunkedEncoding);

  let callbacks;
  this._send(len.toString(16), "latin1", null);
  this._send(crlf_buf, null, null);
  for (let n = 0; n < buf.length; n += 3) {
    this._send(buf[n + 0], buf[n + 1], null);
    if (buf[n + 2]) {
      callbacks ??= [];
      callbacks.push(buf[n + 2]);
    }
  }
  this._send(crlf_buf, null, callbacks?.length ? runChunkCallbacks.bind(undefined, callbacks) : null);

  this[kChunkedBuffer].length = 0;
  this[kChunkedLength] = 0;
};

function runChunkCallbacks(callbacks, err) {
  for (const callback of callbacks) {
    callback(err);
  }
}

OutgoingMessage.prototype.setTimeout = function setTimeout(msecs, callback) {
  if (callback) {
    this.on("timeout", callback);
  }

  if (!this[kSocket]) {
    this.once("socket", function socketSetTimeoutOnConnect(socket) {
      socket.setTimeout(msecs);
    });
  } else {
    this[kSocket].setTimeout(msecs);
  }
  return this;
};

// It's possible that the socket will be destroyed, and removed from
// any messages, before ever calling this.  In that case, just skip
// it, since something else is destroying this connection anyway.
OutgoingMessage.prototype.destroy = function destroy(error) {
  if (this.destroyed) {
    return this;
  }
  this.destroyed = true;

  this[kErrored] = error;

  if (this[kSocket]) {
    this[kSocket].destroy(error);
  } else {
    process.nextTick(emitDestroyNT, this);
  }

  return this;
};

function emitDestroyNT(self) {
  if (!self._closed) {
    self._closed = true;
    self.emit("close");
  }
}

// This abstract either writing directly to the socket or buffering it.
OutgoingMessage.prototype._send = function _send(data, encoding, callback, byteLength) {
  // This is a shameful hack to get the headers and first body chunk onto
  // the same packet. Future versions of Node are going to take care of
  // this at a lower level and in a more general way.
  let header;
  if (!this._headerSent && (header = this._header) !== null) {
    // `this._header` can be null if OutgoingMessage is used without a proper Socket
    // See: /test/parallel/test-http-outgoing-message-inheritance.js
    if (typeof data === "string" && (encoding === "utf8" || encoding === "latin1" || !encoding)) {
      data = header + data;
    } else {
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
};

OutgoingMessage.prototype._writeRaw = _writeRaw;
function _writeRaw(this: any, data, encoding, callback, _size?) {
  const conn = this[kSocket];
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
}

OutgoingMessage.prototype._storeHeader = _storeHeader;
function _storeHeader(this: any, firstLine, headers) {
  // firstLine in the case of request is: 'GET /index.html HTTP/1.1\r\n'
  // in the case of response it is: 'HTTP/1.1 200 OK\r\n'
  const state = {
    connection: false,
    contLen: false,
    te: false,
    date: false,
    expect: false,
    trailer: false,
    header: firstLine,
  };

  const lenient = this._isLenientHeaderValidation();
  if (headers) {
    if (headers === this[kOutHeaders]) {
      for (const key in headers) {
        const entry = headers[key];
        processHeader(this, state, entry[0], entry[1], false, lenient);
      }
    } else if (ArrayIsArray(headers)) {
      const headersLength = headers.length;
      if (headersLength && ArrayIsArray(headers[0])) {
        for (let i = 0; i < headersLength; i++) {
          const entry = headers[i];
          processHeader(this, state, entry[0], entry[1], true, lenient);
        }
      } else {
        if (headersLength % 2 !== 0) {
          throw $ERR_INVALID_ARG_VALUE("headers", headers);
        }

        for (let n = 0; n < headersLength; n += 2) {
          processHeader(this, state, headers[n + 0], headers[n + 1], true, lenient);
        }
      }
    } else {
      for (const key in headers) {
        if (ObjectHasOwn(headers, key)) {
          processHeader(this, state, key, headers[key], true, lenient);
        }
      }
    }
  }

  let { header } = state;

  // Date header
  if (this.sendDate && !state.date) {
    header += "Date: " + utcDate() + "\r\n";
  }

  // Force the connection to close when the response is a 204 No Content or
  // a 304 Not Modified and the user has set a "Transfer-Encoding: chunked"
  // header.
  //
  // RFC 2616 mandates that 204 and 304 responses MUST NOT have a body but
  // node.js used to send out a zero chunk anyway to accommodate clients
  // that don't have special handling for those responses.
  //
  // It was pointed out that this might confuse reverse proxies to the point
  // of creating security liabilities, so suppress the zero chunk and force
  // the connection to close.
  if (this.chunkedEncoding && (this.statusCode === 204 || this.statusCode === 304)) {
    this.chunkedEncoding = false;
    this.shouldKeepAlive = false;
  }

  // keep-alive logic
  if (this._removedConnection) {
    // shouldKeepAlive is generally true for HTTP/1.1. In that common case,
    // even if the connection header isn't sent, we still persist by default.
    this._last = !this.shouldKeepAlive;
  } else if (!state.connection) {
    const shouldSendKeepAlive =
      this.shouldKeepAlive && (state.contLen || this.useChunkedEncodingByDefault || this.agent);
    if (shouldSendKeepAlive && this.maxRequestsOnConnectionReached) {
      header += "Connection: close\r\n";
    } else if (shouldSendKeepAlive) {
      header += "Connection: keep-alive\r\n";
      const keepAliveTimeout = this._keepAliveTimeout;
      if (keepAliveTimeout && this._defaultKeepAlive) {
        const timeoutSeconds = MathFloor(keepAliveTimeout / 1000);
        let max = "";
        const maxRequestsPerSocket = this._maxRequestsPerSocket;
        if (~~maxRequestsPerSocket > 0) {
          max = `, max=${maxRequestsPerSocket}`;
        }
        header += `Keep-Alive: timeout=${timeoutSeconds}${max}\r\n`;
      }
    } else {
      this._last = true;
      header += "Connection: close\r\n";
    }
  }

  if (!state.contLen && !state.te) {
    if (!this._hasBody) {
      // Make sure we don't end the 0\r\n\r\n at the end of the message.
      this.chunkedEncoding = false;
    } else if (!this.useChunkedEncodingByDefault) {
      this._last = true;
    } else {
      let contentLength;
      if (!state.trailer && !this._removedContLen && typeof (contentLength = this._contentLength) === "number") {
        header += "Content-Length: " + contentLength + "\r\n";
      } else if (!this._removedTE) {
        header += "Transfer-Encoding: chunked\r\n";
        this.chunkedEncoding = true;
      } else {
        // We should only be able to get here if both Content-Length and
        // Transfer-Encoding are removed by the user.
        // See: test/parallel/test-http-remove-header-stays-removed.js
        // We can't keep alive in this case, because with no header info the body
        // is defined as all data until the connection is closed.
        this._last = true;
      }
    }
  }

  // Test non-chunked message does not have trailer header set,
  // message will be terminated by the first empty line after the
  // header fields, regardless of the header fields present in the
  // message, and thus cannot contain a message body or 'trailers'.
  if (this.chunkedEncoding !== true && state.trailer) {
    throw $ERR_HTTP_TRAILER_INVALID();
  }

  this._header = header + "\r\n";
  this._headerSent = false;

  // Wait until the first body chunk, or close(), is sent to flush,
  // UNLESS we're sending Expect: 100-continue.
  if (state.expect) this._send("");
}

function processHeader(self, state, key, value, validate, lenient) {
  if (validate) validateHeaderName(key);

  // If key is content-disposition and there is content-length
  // encode the value in latin1
  // https://www.rfc-editor.org/rfc/rfc6266#section-4.3
  // Refs: https://github.com/nodejs/node/pull/46528
  if (isContentDispositionField(key) && self._contentLength) {
    // The value could be an array here
    if (ArrayIsArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = Buffer.from(value[i], "latin1");
      }
    } else {
      value = Buffer.from(value, "latin1");
    }
  }

  if (ArrayIsArray(value)) {
    const valueLength = value.length;
    if (
      (valueLength < 2 || !isCookieField(key)) &&
      (!self[kUniqueHeaders] || !self[kUniqueHeaders].has(key.toLowerCase()))
    ) {
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < valueLength; i++) storeHeader(self, state, key, value[i], validate, lenient);
      return;
    }
    value = value.join("; ");
  }
  storeHeader(self, state, key, value, validate, lenient);
}

// Same as node's three-argument validateHeaderValue in _http_outgoing.js: the lenient flag
// (httpValidation 'relaxed'/'insecure' or insecureHTTPParser) relaxes the character check to
// only reject NUL/CR/LF. The public two-argument validateHeaderValue stays in _http_common.
function validateHeaderValueLenient(name, value, lenient) {
  if (value === undefined) {
    throw $ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(value, lenient)) {
    throw $ERR_INVALID_CHAR("header content", name);
  }
}

function storeHeader(self, state, key, value, validate, lenient) {
  if (validate) validateHeaderValueLenient(key, value, lenient);
  state.header += key + ": " + value + "\r\n";
  matchHeader(self, state, key, value);
}

function matchHeader(self, state, field, value) {
  if (field.length < 4 || field.length > 17) return;
  field = field.toLowerCase();
  switch (field) {
    case "connection":
      state.connection = true;
      self._removedConnection = false;
      if (RE_CONN_CLOSE.test(value)) self._last = true;
      else self.shouldKeepAlive = true;
      break;
    case "transfer-encoding":
      state.te = true;
      self._removedTE = false;
      if (RE_TE_CHUNKED.test(value)) self.chunkedEncoding = true;
      break;
    case "content-length":
      state.contLen = true;
      self._contentLength = +value;
      self._removedContLen = false;
      break;
    case "date":
    case "expect":
    case "trailer":
      state[field] = true;
      break;
    case "keep-alive":
      self._defaultKeepAlive = false;
      break;
  }
}

function parseUniqueHeadersOption(headers) {
  if (!ArrayIsArray(headers)) {
    return null;
  }

  const unique = new Set();
  const l = headers.length;
  for (let i = 0; i < l; i++) {
    unique.add(headers[i].toLowerCase());
  }

  return unique;
}

OutgoingMessage.prototype.setHeader = function setHeader(name, value) {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("set");
  }
  validateHeaderName(name);
  validateHeaderValueLenient(name, value, this._isLenientHeaderValidation());

  let headers = this[kOutHeaders];
  if (headers === null) this[kOutHeaders] = headers = { __proto__: null };

  headers[lowercaseHeaderName(name)] = [name, value];
  return this;
};

OutgoingMessage.prototype.setHeaders = function setHeaders(headers) {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("set");
  }

  if (!headers || ArrayIsArray(headers) || typeof headers.keys !== "function" || typeof headers.get !== "function") {
    throw $ERR_INVALID_ARG_TYPE("headers", ["Headers", "Map"], headers);
  }

  // Headers object joins multiple cookies with a comma when using
  // the getter to retrieve the value,
  // unless iterating over the headers directly.
  // We also cannot safely split by comma.
  // To avoid setHeader overwriting the previous value we push
  // set-cookie values in array and set them all at once.
  let cookies: string[] | null = null;

  for (const { 0: key, 1: value } of headers) {
    if (key === "set-cookie") {
      if (ArrayIsArray(value)) {
        cookies ??= [];
        cookies.push(...value);
      } else {
        cookies ??= [];
        cookies.push(value);
      }
      continue;
    }
    this.setHeader(key, value);
  }
  if (cookies != null) {
    this.setHeader("set-cookie", cookies);
  }

  return this;
};

OutgoingMessage.prototype.appendHeader = function appendHeader(name, value) {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("append");
  }
  validateHeaderName(name);
  validateHeaderValueLenient(name, value, this._isLenientHeaderValidation());

  const field = lowercaseHeaderName(name);
  const headers = this[kOutHeaders];
  if (headers === null || !headers[field]) {
    return this.setHeader(name, value);
  }

  // Prepare the field for appending, if required
  if (!ArrayIsArray(headers[field][1])) {
    headers[field][1] = [headers[field][1]];
  }

  const existingValues = headers[field][1];
  if (ArrayIsArray(value)) {
    for (let i = 0, length = value.length; i < length; i++) {
      existingValues.push(value[i]);
    }
  } else {
    existingValues.push(value);
  }

  return this;
};

OutgoingMessage.prototype.getHeader = function getHeader(name) {
  validateString(name, "name");

  const headers = this[kOutHeaders];
  if (headers === null) return;

  const entry = headers[lowercaseHeaderName(name)];
  return entry?.[1];
};

// Returns an array of the names of the current outgoing headers.
OutgoingMessage.prototype.getHeaderNames = function getHeaderNames() {
  return this[kOutHeaders] !== null ? ObjectKeys(this[kOutHeaders]) : [];
};

// Returns an array of the names of the current outgoing raw headers.
OutgoingMessage.prototype.getRawHeaderNames = function getRawHeaderNames() {
  const headersMap = this[kOutHeaders];
  if (headersMap === null) return [];

  const values = ObjectValues(headersMap);
  const headers = Array(values.length);
  // Retain for(;;) loop for performance reasons
  // Refs: https://github.com/nodejs/node/pull/30958
  for (let i = 0, l = values.length; i < l; i++) {
    headers[i] = values[i][0];
  }

  return headers;
};

// Returns a shallow copy of the current outgoing headers.
OutgoingMessage.prototype.getHeaders = function getHeaders() {
  const headers = this[kOutHeaders];
  const ret = { __proto__: null };
  if (headers) {
    const keys = ObjectKeys(headers);
    // Retain for(;;) loop for performance reasons
    // Refs: https://github.com/nodejs/node/pull/30958
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      const val = headers[key][1];
      ret[key] = val;
    }
  }
  return ret;
};

OutgoingMessage.prototype.hasHeader = function hasHeader(name) {
  validateString(name, "name");
  return this[kOutHeaders] !== null && !!this[kOutHeaders][lowercaseHeaderName(name)];
};

OutgoingMessage.prototype.removeHeader = function removeHeader(name) {
  validateString(name, "name");

  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("remove");
  }

  const key = lowercaseHeaderName(name);

  switch (key) {
    case "connection":
      this._removedConnection = true;
      break;
    case "content-length":
      this._removedContLen = true;
      break;
    case "transfer-encoding":
      this._removedTE = true;
      break;
    case "date":
      this.sendDate = false;
      break;
  }

  if (this[kOutHeaders] !== null) {
    delete this[kOutHeaders][key];
  }
};

OutgoingMessage.prototype._implicitHeader = function _implicitHeader() {
  throw $ERR_METHOD_NOT_IMPLEMENTED("_implicitHeader()");
};

ObjectDefineProperty(OutgoingMessage.prototype, "headersSent", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: function () {
    return !!this._header;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableEnded", {
  __proto__: null,
  get: function () {
    return this.finished;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableNeedDrain", {
  __proto__: null,
  get: function () {
    return !this.destroyed && !this.finished && this[kNeedDrain];
  },
});

const crlf_buf = Buffer.from("\r\n");
OutgoingMessage.prototype.write = function write(chunk, encoding, callback) {
  if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }

  const ret = write_(this, chunk, encoding, callback, false);
  if (!ret) this[kNeedDrain] = true;
  return ret;
};

function onError(msg, err, callback) {
  if (msg.destroyed) {
    return;
  }

  process.nextTick(emitErrorNt, msg, err, callback);
}

function emitErrorNt(msg, err, callback) {
  callback(err);
  if (typeof msg.emit === "function" && !msg.destroyed) {
    msg.emit("error", err);
  }
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

    const contentLength = msg._contentLength;
    if (
      strictContentLength(msg) &&
      (fromEnd ? msg[kBytesWritten] + len !== contentLength : msg[kBytesWritten] + len > contentLength)
    ) {
      throw $ERR_HTTP_CONTENT_LENGTH_MISMATCH(len + msg[kBytesWritten], contentLength);
    }

    msg[kBytesWritten] += len;
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
      // This type of response MUST NOT have a body.
      // Ignoring write() calls.
      process.nextTick(callback);
      return true;
    }
  }

  let msgSocket;
  if (!fromEnd && (msgSocket = msg.socket) && !msgSocket.writableCorked) {
    msgSocket.cork();
    process.nextTick(connectionCorkNT, msgSocket);
  }

  let ret;
  if (msg.chunkedEncoding && chunk.length !== 0) {
    len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
    if (msg[kCorked] && msg._headerSent) {
      msg[kChunkedBuffer].push(chunk, encoding, callback);
      msg[kChunkedLength] += len;
      ret = msg[kChunkedLength] < msg[kHighWaterMark];
    } else {
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

function connectionCorkNT(conn) {
  conn.uncork();
}

OutgoingMessage.prototype.addTrailers = function addTrailers(headers) {
  this._trailer = "";
  const keys = ObjectKeys(headers);
  const isArray = ArrayIsArray(headers);
  const lenient = this._isLenientHeaderValidation();
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
    const isArrayValue = ArrayIsArray(value);
    const valueLength = isArrayValue ? value.length : 0;
    if (isArrayValue && valueLength > 1 && (!this[kUniqueHeaders] || !this[kUniqueHeaders].has(field.toLowerCase()))) {
      for (let j = 0, l = valueLength; j < l; j++) {
        if (checkInvalidHeaderChar(value[j], lenient)) {
          throw $ERR_INVALID_CHAR("trailer content", field);
        }
        this._trailer += field + ": " + value[j] + "\r\n";
      }
    } else {
      if (isArrayValue) {
        value = value.join("; ");
      }

      if (checkInvalidHeaderChar(value, lenient)) {
        throw $ERR_INVALID_CHAR("trailer content", field);
      }
      this._trailer += field + ": " + value + "\r\n";
    }
  }
};

function onFinish(outmsg) {
  if (outmsg?.socket?._hadError) return;
  outmsg.emit("finish");
}

OutgoingMessage.prototype.end = function end(chunk, encoding, callback) {
  if (typeof chunk === "function") {
    callback = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }

  if (chunk) {
    if (this.finished) {
      onError(this, $ERR_STREAM_WRITE_AFTER_END(), typeof callback !== "function" ? nop : callback);
      return this;
    }

    if (this[kSocket]) {
      this[kSocket].cork();
    }

    write_(this, chunk, encoding, null, true);
  } else if (this.finished) {
    if (typeof callback === "function") {
      if (!this.writableFinished) {
        this.on("finish", callback);
      } else {
        callback($ERR_STREAM_ALREADY_FINISHED("end"));
      }
    }
    return this;
  } else if (!this._header) {
    if (this[kSocket]) {
      this[kSocket].cork();
    }

    this._contentLength = 0;
    this._implicitHeader();
  }

  if (typeof callback === "function") this.once("finish", callback);

  let contentLength;
  if (strictContentLength(this) && this[kBytesWritten] !== (contentLength = this._contentLength)) {
    throw $ERR_HTTP_CONTENT_LENGTH_MISMATCH(this[kBytesWritten], contentLength);
  }

  const finish = onFinish.bind(undefined, this);

  if (this._hasBody && this.chunkedEncoding) {
    this._send("0\r\n" + this._trailer + "\r\n", "latin1", finish);
  } else if (!this._headerSent || this.writableLength || chunk) {
    this._send("", "latin1", finish);
  } else {
    process.nextTick(finish);
  }

  if (this[kSocket]) {
    // Fully uncork connection on end().
    this[kSocket]._writableState.corked = 1;
    this[kSocket].uncork();
  }
  this[kCorked] = 1;
  this.uncork();

  this.finished = true;

  // There is the first message on the outgoing queue, and we've sent
  // everything to the socket.
  if (this.outputData.length === 0 && this[kSocket] && this[kSocket]._httpMessage === this) {
    this._finish();
  }

  return this;
};

// This function is called once all user data are flushed to the socket.
// Note that it has a chance that the socket is not drained.
OutgoingMessage.prototype._finish = function _finish() {
  $assert(this[kSocket]);
  this.emit("prefinish");
};

// This logic is probably a bit confusing. Let me explain a bit:
//
// In both HTTP servers and clients it is possible to queue up several
// outgoing messages. This is easiest to imagine in the case of a client.
// Take the following situation:
//
//    req1 = client.request('GET', '/');
//    req2 = client.request('POST', '/');
//
// When the user does
//
//   req2.write('hello world\n');
//
// it's possible that the first request has not been completely flushed to
// the socket yet. Thus the outgoing messages need to be prepared to queue
// up data internally before sending it on further to the socket's queue.
//
// This function, _flush(), is called by both the Server and Client
// to attempt to flush any pending messages out to the socket.
OutgoingMessage.prototype._flush = function _flush() {
  const socket = this[kSocket];

  if (socket?.writable) {
    // There might be remaining data in this.output; write it out
    this._flushOutput(socket);

    if (this.finished) {
      // This is a queue to the server or client to bring in the next this.
      this._finish();
    } else if (this[kNeedDrain] && this.writableLength === 0) {
      this[kNeedDrain] = false;
      this.emit("drain");
    }
  }
};

OutgoingMessage.prototype._flushOutput = function _flushOutput(socket) {
  const outputLength = this.outputData.length;
  if (outputLength <= 0) return undefined;

  const outputData = this.outputData;
  socket.cork();
  let ret;
  // Retain for(;;) loop for performance reasons
  // Refs: https://github.com/nodejs/node/pull/30958
  for (let i = 0; i < outputLength; i++) {
    const { data, encoding, callback } = outputData[i];
    // Avoid any potential ref to Buffer in new generation from old generation
    outputData[i].data = null;
    ret = socket.write(data, encoding, callback);
  }
  socket.uncork();

  this.outputData = [];
  this._onPendingData(-this.outputSize);
  this.outputSize = 0;

  return ret;
};

OutgoingMessage.prototype.flushHeaders = function flushHeaders() {
  if (!this._header) {
    this._implicitHeader();
  }

  // Force-flush the headers.
  this._send("");
};

OutgoingMessage.prototype.pipe = function pipe() {
  // OutgoingMessage should be write-only. Piping from it is disabled.
  this.emit("error", $ERR_STREAM_CANNOT_PIPE());
};

OutgoingMessage.prototype[EE.captureRejectionSymbol] = function (err, _event) {
  this.destroy(err);
};

ObjectDefineProperty(OutgoingMessage.prototype, "_headers", {
  __proto__: null,
  get: deprecate(
    function (this: any) {
      return this.getHeaders();
    },
    "OutgoingMessage.prototype._headers is deprecated",
    "DEP0066",
  ),
  set: deprecate(
    function (this: any, val) {
      if (val == null) {
        this[kOutHeaders] = null;
      } else if (typeof val === "object") {
        const headers = (this[kOutHeaders] = { __proto__: null });
        const keys = ObjectKeys(val);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; ++i) {
          const name = keys[i];
          headers[lowercaseHeaderName(name)] = [name, val[name]];
        }
      }
    },
    "OutgoingMessage.prototype._headers is deprecated",
    "DEP0066",
  ),
});

// Bun-specific accessor: the same contract as the deprecated _headers, kept
// because existing code reads and assigns res.headers on outgoing messages.
ObjectDefineProperty(OutgoingMessage.prototype, "headers", {
  __proto__: null,
  get(this: any) {
    return this.getHeaders();
  },
  set(this: any, val) {
    if (val == null) {
      this[kOutHeaders] = null;
    } else if (typeof val === "object") {
      this[kOutHeaders] = { __proto__: null };
      const keys = ObjectKeys(val);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; ++i) {
        const name = keys[i];
        // Route through setHeader so name/value are validated — the
        // un-prefixed `headers` alias is Bun-public and previously validated
        // (via the WHATWG Headers constructor), and the ServerResponse
        // override of this setter routes through setHeader too.
        this.setHeader(name, val[name]);
      }
    }
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "_headerNames", {
  __proto__: null,
  get: deprecate(
    function (this: any) {
      const headers = this[kOutHeaders];
      if (headers !== null) {
        const out = { __proto__: null };
        const keys = ObjectKeys(headers);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; ++i) {
          const key = keys[i];
          const val = headers[key][0];
          out[key] = val;
        }
        return out;
      }
      return null;
    },
    "OutgoingMessage.prototype._headerNames is deprecated",
    "DEP0066",
  ),
  set: deprecate(
    function (this: any, val) {
      if (typeof val === "object" && val !== null) {
        const headers = this[kOutHeaders];
        if (!headers) return;
        const keys = ObjectKeys(val);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; ++i) {
          const header = headers[keys[i]];
          if (header) header[0] = val[keys[i]];
        }
      }
    },
    "OutgoingMessage.prototype._headerNames is deprecated",
    "DEP0066",
  ),
});

export default {
  kHighWaterMark,
  kUniqueHeaders,
  kOutHeaders,
  kErrored,
  kSocket,
  kChunkedLength,
  kRejectNonStandardBodyWrites,
  parseUniqueHeadersOption,
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage,
  FakeSocket,
};
