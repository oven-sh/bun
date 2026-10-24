// Hardcoded module "node:_http_outgoing"
// This is a port of Node.js's lib/_http_outgoing.js
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js
require("internal/stream");
const { Stream } = require("internal/streams/legacy");
const { isUint8Array, validateString } = require("internal/validators");
const { deprecate } = require("internal/util/deprecate");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const http = require("internal/http");
const { utcDate } = http;
// A symbol taken out of a pattern is a plain `symbol` for the type checker, and what it keys is untyped.
const kOutHeaders: typeof http.kOutHeaders = http.kOutHeaders;
const kNeedDrain: typeof http.kNeedDrain = http.kNeedDrain;
const kErrored: typeof http.kErrored = http.kErrored;
const kHighWaterMark: typeof http.kHighWaterMark = http.kHighWaterMark;
const kSocket: typeof http.kSocket = http.kSocket;
const kRejectNonStandardBodyWrites: typeof http.kRejectNonStandardBodyWrites = http.kRejectNonStandardBodyWrites;
const kUniqueHeaders: typeof http.kUniqueHeaders = http.kUniqueHeaders;
const kHandle: typeof http.kHandle = http.kHandle;
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
// allocation on the common path. validatedLowercaseHeaderName takes a key of
// this table for a valid header name, which is why each one is validated here.
const commonLowercasedHeaders = { __proto__: null } as $Node.Dictionary<string | undefined>;
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
  validateHeaderName(name);
  validateHeaderName(titled);
}
// Spellings that title-casing does not produce.
commonLowercasedHeaders["ETag"] = "etag";
commonLowercasedHeaders["etag"] = "etag";
validateHeaderName("ETag");

function lowercaseHeaderName(name: string) {
  const known = commonLowercasedHeaders[name];
  return known !== undefined ? known : name.toLowerCase();
}

// validateHeaderName(name), then the lowercased name. An application sets the same few names on every message, so
// a spelling that passed is kept with its lowercased name and is not matched against the token grammar again.
// A name can also come from outside (a proxy setting the headers it received), so the table starts over when it
// is full instead of staying filled with names nobody sets again.
const kMaxValidatedHeaderNames = 256;
const kMaxValidatedHeaderNameLength = 64;
let validatedHeaderNames = { __proto__: null } as $Node.Dictionary<string | undefined>;
let validatedHeaderNameCount = 0;
function validatedLowercaseHeaderName(name: string) {
  if (typeof name === "string") {
    const known = commonLowercasedHeaders[name] ?? validatedHeaderNames[name];
    if (known !== undefined) return known;
  }
  validateHeaderName(name);
  const lowercased = name.toLowerCase();
  if (name.length <= kMaxValidatedHeaderNameLength) {
    if (validatedHeaderNameCount === kMaxValidatedHeaderNames) {
      validatedHeaderNames = { __proto__: null } as $Node.Dictionary<string | undefined>;
      validatedHeaderNameCount = 0;
    }
    validatedHeaderNameCount++;
    validatedHeaderNames[name] = lowercased;
  }
  return lowercased;
}

const kCorked: typeof http.kCorked = http.kCorked;
const kChunkedBuffer: typeof http.kChunkedBuffer = http.kChunkedBuffer;
const kChunkedLength: typeof http.kChunkedLength = http.kChunkedLength;
const kBytesWritten: typeof http.kBytesWritten = http.kBytesWritten;
const kLenientValidation: typeof http.kLenientValidation = http.kLenientValidation;
const kExchange: typeof http.kExchange = http.kExchange;

const nop = () => {};

const RE_CONN_CLOSE = /(?:^|\W)close(?:$|\W)/i;

// isCookieField performs a case-insensitive comparison of a provided string
// against the word "cookie." As of V8 6.6 this is faster than handrolling or
// using a case-insensitive RegExp.
function isCookieField(s: string) {
  return s.length === 6 && s.toLowerCase() === "cookie";
}

function isContentDispositionField(s: string) {
  return s.length === 19 && s.toLowerCase() === "content-disposition";
}

declare global {
  namespace $Node {
    interface OutgoingMessageOptions extends EventEmitterOptions {
      highWaterMark?: number;
      rejectNonStandardBodyWrites?: boolean;
    }

    interface OutgoingMessageOutput {
      data: HttpChunk | null;
      encoding: string | null | undefined;
      callback: HttpWriteCallback | null | undefined;
    }

    interface OutgoingMessage extends Stream {
      outputData: OutgoingMessageOutput[];
      outputSize: number;
      writable: boolean;
      destroyed: boolean;
      finished: boolean;
      chunkedEncoding: boolean;
      shouldKeepAlive: boolean;
      maxRequestsOnConnectionReached: boolean;
      useChunkedEncodingByDefault: boolean;
      sendDate: boolean;
      strictContentLength: boolean;
      socket: HttpSocket | null;
      connection: HttpSocket | null;
      headers: Dictionary<HttpHeaderValue>;
      readonly errored: Error | null | undefined;
      readonly closed: boolean;
      readonly headersSent: boolean;
      readonly writableEnded: boolean;
      readonly writableFinished: boolean;
      readonly writableObjectMode: boolean;
      readonly writableLength: number;
      readonly writableHighWaterMark: number;
      readonly writableCorked: number;
      readonly writableNeedDrain: boolean;
      _last: boolean;
      _defaultKeepAlive: boolean;
      _removedConnection: boolean;
      _removedContLen: boolean;
      _removedTE: boolean;
      _contentLength: number | null;
      _hasBody: boolean;
      _trailer: string;
      _headerSent: boolean;
      _closed: boolean;
      _header: string | null;
      _keepAliveTimeout: number | undefined;
      _maxRequestsPerSocket?: number | null;
      _onPendingData: (delta: number) => void;
      /** A `ClientRequest` has the two options itself. A `ServerResponse` takes them from the server of `req`. */
      httpValidation?: "strict" | "relaxed" | "insecure";
      insecureHTTPParser?: boolean;
      req?: IncomingMessage;
      agent?: Agent | false | null;
      statusCode?: number;
      _isLenientHeaderValidation(): boolean;
      _renderHeaders(): Record<string, HttpHeaderValue>;
      cork(): void;
      uncork(): void;
      setTimeout(msecs: number, callback?: () => void): this;
      destroy(error?: Error | null): this;
      _send(
        data: HttpChunk,
        encoding?: string | null,
        callback?: HttpWriteCallback | null,
        byteLength?: number,
      ): boolean | undefined;
      _writeRaw(
        data: HttpChunk,
        encoding?: string | null | HttpWriteCallback,
        callback?: HttpWriteCallback | null,
        size?: number,
      ): boolean;
      _storeHeader(firstLine: string, headers: OutgoingHttpHeaders | HttpHeadersInit | null | undefined): void;
      setHeader(name: string, value: HttpHeaderValue): this;
      setHeaders(headers: Iterable<[name: string, value: HttpHeaderValue]>): this;
      appendHeader(name: string, value: HttpHeaderValue): this;
      getHeader(name: string): HttpHeaderValue | undefined;
      getHeaderNames(): string[];
      getRawHeaderNames(): string[];
      getHeaders(): Dictionary<HttpHeaderValue>;
      hasHeader(name: string): boolean;
      removeHeader(name: string): void;
      _implicitHeader(): void;
      write(
        chunk: HttpChunk,
        encoding?: string | null | HttpWriteCallback,
        callback?: HttpWriteCallback | null,
      ): boolean | undefined;
      addTrailers(headers: Record<string, HttpHeaderValue> | [name: string, value: HttpHeaderValue][]): void;
      end(
        chunk?: HttpChunk | null | HttpWriteCallback,
        encoding?: string | null | HttpWriteCallback,
        callback?: HttpWriteCallback | null,
      ): this;
      _finish(): void;
      _flush(): void;
      _flushOutput(socket: HttpSocket): boolean | undefined;
      flushHeaders(): void;
      [kCorked]: number;
      /** Three entries a chunk: the chunk, its encoding, its callback. */
      [kChunkedBuffer]: (HttpChunk | string | HttpWriteCallback | null | undefined)[];
      [kChunkedLength]: number;
      [kBytesWritten]: number;
      [kLenientValidation]: boolean | undefined;
    }

    interface Writable {
      write(chunk: unknown, encoding: string | null | undefined, callback: ErrorCallback | null | undefined): boolean;
    }

    interface OutgoingMessageConstructor {
      new (options?: OutgoingMessageOptions): OutgoingMessage;
      (this: OutgoingMessage, options?: OutgoingMessageOptions): void;
      /** The form of `ServerResponse` for a request of the native listener. */
      (
        this: OutgoingMessage,
        marker: typeof kHandle,
        highWaterMark: number | undefined,
        rejectNonStandardBodyWrites: boolean | undefined,
        keepAliveTimeout: number,
      ): void;
      prototype: any;
    }
  }
}

function OutgoingMessage(
  this: $Node.OutgoingMessage,
  options?: $Node.OutgoingMessageOptions | typeof kHandle,
  highWaterMark: number | undefined = undefined,
  rejectNonStandardBodyWrites: boolean | undefined = undefined,
  keepAliveTimeout: number | undefined = undefined,
) {
  if (options === kHandle) {
    Stream.$call(this, undefined);
    highWaterMark ??= getDefaultHighWaterMark();
    if (rejectNonStandardBodyWrites === undefined) rejectNonStandardBodyWrites = false;
  } else {
    Stream.$call(this, options);
    highWaterMark = options?.highWaterMark ?? getDefaultHighWaterMark();
    rejectNonStandardBodyWrites = options?.rejectNonStandardBodyWrites ?? false;
    keepAliveTimeout = 0;
  }

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

  this._keepAliveTimeout = keepAliveTimeout;

  this._onPendingData = nop;

  this[kErrored] = null;
  this[kHighWaterMark] = highWaterMark;
  this[kRejectNonStandardBodyWrites] = rejectNonStandardBodyWrites;
  // Declared here so the memoizing _isLenientHeaderValidation never
  // shape-transitions the message when it caches.
  this[kLenientValidation] = undefined;
  this[kExchange] = undefined;
}
$toClass(OutgoingMessage, "OutgoingMessage", Stream);

// Check if lenient header validation should be used.
// For ClientRequest: checks this.httpValidation or this.insecureHTTPParser
// For ServerResponse: checks the server's httpValidation or insecureHTTPParser
// Falls back to global --insecure-http-parser flag.
// Every input is fixed for the life of the message, but setHeader and
// appendHeader consult this once per header: compute once, cache in the
// constructor-declared slot.
OutgoingMessage.prototype._isLenientHeaderValidation = function (this: $Node.OutgoingMessage) {
  const cached = this[kLenientValidation];
  if (cached !== undefined) return cached;
  return (this[kLenientValidation] = computeLenientHeaderValidation(this));
};

function computeLenientHeaderValidation(message: $Node.OutgoingMessage): boolean {
  // New httpValidation option takes priority (ClientRequest case)
  const httpValidation = message.httpValidation;
  if (httpValidation !== undefined) return httpValidation !== "strict";
  // ServerResponse routes both options through the owning server; walk the req -> socket -> server chain once, not once per option.
  const server = getServer(message);
  const serverHttpValidation = getServerHttpValidation(server);
  if (serverHttpValidation !== undefined) return serverHttpValidation !== "strict";
  // Legacy insecureHTTPParser - ClientRequest has it directly
  const insecureHTTPParser = message.insecureHTTPParser;
  if (typeof insecureHTTPParser === "boolean") return insecureHTTPParser;
  // ServerResponse can access via the server
  const serverOption = getServerInsecureHTTPParser(server);
  return typeof serverOption === "boolean" ? serverOption : isLenient();
}

function getServer(message: $Node.OutgoingMessage) {
  return message.req?.socket?.server;
}

function getServerHttpValidation(server: $Node.HttpSocketServer | null | undefined) {
  return server?.httpValidation;
}

function getServerInsecureHTTPParser(server: $Node.HttpSocketServer | null | undefined) {
  return server?.insecureHTTPParser;
}

ObjectDefineProperty(OutgoingMessage.prototype, "errored", {
  __proto__: null,
  get(this: $Node.OutgoingMessage) {
    return this[kErrored];
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "closed", {
  __proto__: null,
  get(this: $Node.OutgoingMessage) {
    return this._closed;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableFinished", {
  __proto__: null,
  get(this: $Node.OutgoingMessage) {
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
  get(this: $Node.OutgoingMessage) {
    return this.outputSize + this[kChunkedLength] + (this[kSocket] ? this[kSocket].writableLength : 0);
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableHighWaterMark", {
  __proto__: null,
  get(this: $Node.OutgoingMessage) {
    return this[kSocket] ? this[kSocket].writableHighWaterMark : this[kHighWaterMark];
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableCorked", {
  __proto__: null,
  get(this: $Node.OutgoingMessage) {
    return this[kCorked];
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "connection", {
  __proto__: null,
  get: function (this: $Node.OutgoingMessage) {
    return this[kSocket];
  },
  set: function (this: $Node.OutgoingMessage, val: $Node.HttpSocket | null) {
    this.socket = val;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "socket", {
  __proto__: null,
  get: function (this: $Node.OutgoingMessage) {
    return this[kSocket];
  },
  set: function (this: $Node.OutgoingMessage, val: $Node.HttpSocket | null) {
    for (let n = 0; n < this[kCorked]; n++) {
      val?.cork();
      this[kSocket]?.uncork();
    }
    this[kSocket] = val;
  },
});

OutgoingMessage.prototype._renderHeaders = function _renderHeaders(this: $Node.OutgoingMessage) {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("render");
  }

  spillHeadersOf(this);
  const headersMap = this[kOutHeaders];
  const headers: Record<string, $Node.HttpHeaderValue> = {};

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

OutgoingMessage.prototype.cork = function cork(this: $Node.OutgoingMessage) {
  this[kCorked]++;
  if (this[kSocket]) {
    this[kSocket].cork();
  }
};

OutgoingMessage.prototype.uncork = function uncork(this: $Node.OutgoingMessage) {
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

  let callbacks: $Node.HttpWriteCallback[] | undefined;
  this._send(len.toString(16), "latin1", null);
  this._send(crlf_buf, null, null);
  for (let n = 0; n < buf.length; n += 3) {
    this._send(buf[n + 0] as $Node.HttpChunk, buf[n + 1] as string | null | undefined, null);
    if (buf[n + 2]) {
      callbacks ??= [];
      callbacks.push(buf[n + 2] as $Node.HttpWriteCallback);
    }
  }
  this._send(crlf_buf, null, callbacks?.length ? runChunkCallbacks.bind(undefined, callbacks) : null);

  this[kChunkedBuffer].length = 0;
  this[kChunkedLength] = 0;
};

function runChunkCallbacks(callbacks: $Node.HttpWriteCallback[], err?: Error | null) {
  for (const callback of callbacks) {
    callback(err);
  }
}

OutgoingMessage.prototype.setTimeout = function setTimeout(
  this: $Node.OutgoingMessage,
  msecs: number,
  callback?: () => void,
) {
  if (callback) {
    this.on("timeout", callback);
  }

  if (!this[kSocket]) {
    this.once("socket", function socketSetTimeoutOnConnect(socket: $Node.HttpSocket) {
      socket.setTimeout!(msecs);
    });
  } else {
    this[kSocket].setTimeout!(msecs);
  }
  return this;
};

// It's possible that the socket will be destroyed, and removed from
// any messages, before ever calling this.  In that case, just skip
// it, since something else is destroying this connection anyway.
OutgoingMessage.prototype.destroy = function destroy(this: $Node.OutgoingMessage, error?: Error | null) {
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

function emitDestroyNT(self: $Node.OutgoingMessage) {
  if (!self._closed) {
    self._closed = true;
    self.emit("close");
  }
}

// This abstract either writing directly to the socket or buffering it.
OutgoingMessage.prototype._send = function _send(
  this: $Node.OutgoingMessage,
  data: $Node.HttpChunk,
  encoding?: string | null,
  callback?: $Node.HttpWriteCallback | null,
  byteLength?: number,
) {
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
function _writeRaw(
  this: $Node.OutgoingMessage,
  data: $Node.HttpChunk,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
  _size?: number,
) {
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
function _storeHeader(
  this: $Node.OutgoingMessage,
  firstLine: string,
  headers: $Node.OutgoingHttpHeaders | $Node.HttpHeadersInit | null | undefined,
) {
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
          processHeader(this, state, (headers as string[])[n + 0], (headers as string[])[n + 1], true, lenient);
        }
      }
    } else {
      for (const key in headers) {
        if (ObjectHasOwn(headers, key)) {
          processHeader(this, state, key, (headers as Record<string, $Node.HttpHeaderValue>)[key], true, lenient);
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
        if (~~maxRequestsPerSocket! > 0) {
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

interface StoredHeaderState {
  connection: boolean;
  contLen: boolean;
  te: boolean;
  date: boolean;
  expect: boolean;
  trailer: boolean;
  header: string;
}

function processHeader(
  self: $Node.OutgoingMessage,
  state: StoredHeaderState,
  key: string,
  value: number | string | Buffer | (number | string | Buffer)[],
  validate: boolean,
  lenient: boolean,
) {
  if (validate) validateHeaderName(key);

  // If key is content-disposition and there is content-length
  // encode the value in latin1
  // https://www.rfc-editor.org/rfc/rfc6266#section-4.3
  // Refs: https://github.com/nodejs/node/pull/46528
  if (isContentDispositionField(key) && self._contentLength) {
    // The value could be an array here
    if (ArrayIsArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = Buffer.from(value[i] as string, "latin1");
      }
    } else {
      value = Buffer.from(value as string, "latin1");
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
function validateHeaderValueLenient(
  name: string,
  value: number | string | Buffer | (number | string)[],
  lenient: boolean,
) {
  if (value === undefined) {
    throw $ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(value, lenient)) {
    throw $ERR_INVALID_CHAR("header content", name);
  }
}

function storeHeader(
  self: $Node.OutgoingMessage,
  state: StoredHeaderState,
  key: string,
  value: $Node.HttpHeaderValue | Buffer,
  validate: boolean,
  lenient: boolean,
) {
  if (validate) validateHeaderValueLenient(key, value, lenient);
  state.header += key + ": " + value + "\r\n";
  matchHeader(self, state, key, value);
}

function matchHeader(
  self: $Node.OutgoingMessage,
  state: StoredHeaderState,
  field: string,
  value: $Node.HttpHeaderValue | Buffer,
) {
  if (field.length < 4 || field.length > 17) return;
  field = field.toLowerCase();
  switch (field) {
    case "connection":
      state.connection = true;
      self._removedConnection = false;
      if (RE_CONN_CLOSE.test(value as string)) self._last = true;
      else self.shouldKeepAlive = true;
      break;
    case "transfer-encoding":
      state.te = true;
      self._removedTE = false;
      if (RE_TE_CHUNKED.test(value as string)) self.chunkedEncoding = true;
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

function parseUniqueHeadersOption(headers: string[] | null | undefined) {
  if (!ArrayIsArray(headers)) {
    return null;
  }

  const unique = new Set<string>();
  const l = headers.length;
  for (let i = 0; i < l; i++) {
    unique.add(headers[i].toLowerCase());
  }

  return unique;
}

const HEADER_DATE = 1 << 0;
const HEADER_CONNECTION = 1 << 1;
const HEADER_KEEP_ALIVE = 1 << 2;
const HEADER_TRANSFER_ENCODING = 1 << 3;
const HEADER_CONTENT_LENGTH = 1 << 4;
const HEADER_TRAILER = 1 << 5;
const HEADER_SPILLED = 1 << 6;

const kInlineHeaderValues = 6;
const kMaxShapedHeaders = 31;
const kMaxHeaderShapes = 512;
let headerShapeCount = 0;

class HeaderShape {
  count: number;
  bits: number;
  name: string;
  key: string;
  parent: HeaderShape;
  checkedValue: string;
  checkedAgainValue: string;
  nextName: string;
  next: HeaderShape;
  children: HeaderShape[];
  againName: string;
  againIndex: number;
  foundName0: string;
  foundIndex0: number;
  foundName1: string;
  foundIndex1: number;
  foundName2: string;
  foundIndex2: number;
  foundTurn: number;
  names: string[] | null;
  keys: string[] | null;
  withoutIndex: number;
  without: HeaderShape;

  constructor(parent: HeaderShape | null, name: string, key: string, bits: number) {
    this.count = parent === null ? 0 : parent.count + 1;
    this.bits = parent === null ? 0 : parent.bits | bits;
    this.name = name;
    this.key = key;
    this.parent = parent === null ? this : parent;
    this.checkedValue = "";
    this.checkedAgainValue = "";
    this.nextName = "";
    this.next = this;
    this.children = [];
    this.againName = "";
    this.againIndex = -1;
    this.foundName0 = "";
    this.foundIndex0 = -1;
    this.foundName1 = "";
    this.foundIndex1 = -1;
    this.foundName2 = "";
    this.foundIndex2 = -1;
    this.foundTurn = 0;
    this.names = null;
    this.keys = null;
    this.withoutIndex = -1;
    this.without = this;
  }
}

interface ResponseEvents {
  __proto__: null;
  finish: $Node.Listener | $Node.Listener[] | undefined;
}

class Exchange {
  flags: number;
  headerState: number;
  headerBits: number;
  shape: HeaderShape;
  value0: number | string;
  value1: number | string;
  value2: number | string;
  value3: number | string;
  value4: number | string;
  value5: number | string;
  heldChunk: string;
  statusCode: number;
  statusMessage: string;
  bytesBuffered: number;
  isFrozenChunked: boolean;
  isImplicitFromEnd: boolean;
  /** The socket the dispatcher already detached a synchronously-finished response from. */
  detachedFrom: $Node.HttpServerSocket | null;
  isReplaying: boolean;
  isFlushScheduled: boolean;
  mustClose: boolean;
  response: $Node.ServerResponse;
  connection: $Node.HttpServerSocket | null;
  endCallback: $Node.HttpWriteCallback | null;
  tickMark: import("internal/process/tick_ring").Tick | null;
  events: ResponseEvents;
  pendingFinish: $Node.HttpWriteCallback | null | undefined;
  holdsNumber: boolean;
  onWritable: (() => void) | null;
  awaitsClose: boolean;
  dispatchPromise: Promise<void> | null;
  idleTimeout: number;
  requestKind: number;
  moreValues: (number | string)[] | null;
  oddValues: unknown[] | null;
  oddMask: number;
  wasEmptied: boolean;
  requestState: $Node.ReadableState | null;

  constructor(
    response: $Node.ServerResponse,
    connection: $Node.HttpServerSocket | null,
    events: ResponseEvents,
    requestState: $Node.ReadableState | null,
  ) {
    this.flags = 0;
    this.headerState = 0;
    this.headerBits = 0;
    this.shape = noHeadersShape;
    this.value0 = 0;
    this.value1 = 0;
    this.value2 = 0;
    this.value3 = 0;
    this.value4 = 0;
    this.value5 = 0;
    this.heldChunk = "";
    this.statusCode = 0;
    this.statusMessage = "";
    this.bytesBuffered = 0;
    this.isFrozenChunked = false;
    this.isImplicitFromEnd = false;
    this.detachedFrom = null;
    this.isReplaying = false;
    this.isFlushScheduled = false;
    this.mustClose = false;
    this.response = response;
    this.connection = connection;
    this.endCallback = null;
    this.tickMark = null;
    this.events = events;
    this.pendingFinish = undefined;
    this.holdsNumber = false;
    this.onWritable = null;
    this.awaitsClose = false;
    this.dispatchPromise = null;
    this.idleTimeout = 0;
    this.requestKind = 0;
    this.moreValues = null;
    this.oddValues = null;
    this.oddMask = 0;
    this.wasEmptied = false;
    this.requestState = requestState;
  }
}

declare global {
  namespace $Node {
    type HttpExchange = Exchange;
    type HttpResponseEvents = ResponseEvents;
    interface OutgoingMessage {
      [kExchange]: Exchange | undefined;
    }
  }
}

const noHeadersShape = new HeaderShape(null, "", "", 0);
const spilledHeadersShape = new HeaderShape(null, "", "", 0);
const noHeaders: unknown[] = [];

function makeExchange(
  response: $Node.ServerResponse,
  connection: $Node.HttpServerSocket | null,
  events: ResponseEvents,
  requestState: $Node.ReadableState | null,
): Exchange {
  return new Exchange(response, connection, events, requestState);
}

function bitsOfHeaderKey(key: string): number {
  switch (key) {
    case "date":
      return HEADER_DATE;
    case "connection":
      return HEADER_CONNECTION;
    case "keep-alive":
      return HEADER_KEEP_ALIVE;
    case "transfer-encoding":
      return HEADER_TRANSFER_ENCODING;
    case "content-length":
      return HEADER_CONTENT_LENGTH;
    case "trailer":
      return HEADER_TRAILER;
  }
  return 0;
}

function putShapedValue(exchange: Exchange, index: number, value: number | string): void {
  if (exchange.oddMask !== 0) exchange.oddMask &= ~(1 << index);
  switch (index) {
    case 0:
      exchange.value0 = value;
      return;
    case 1:
      exchange.value1 = value;
      return;
    case 2:
      exchange.value2 = value;
      return;
    case 3:
      exchange.value3 = value;
      return;
    case 4:
      exchange.value4 = value;
      return;
    case 5:
      exchange.value5 = value;
      return;
  }
  let more = exchange.moreValues;
  if (more === null) exchange.moreValues = more = [];
  more[index - kInlineHeaderValues] = value;
}

function putOddValue(exchange: Exchange, index: number, value: unknown): void {
  putShapedValue(exchange, index, "");
  let odd = exchange.oddValues;
  if (odd === null) exchange.oddValues = odd = [];
  odd[index] = value;
  exchange.oddMask |= 1 << index;
  exchange.holdsNumber = true;
}

function plainShapedValue(exchange: Exchange, index: number): number | string {
  switch (index) {
    case 0:
      return exchange.value0;
    case 1:
      return exchange.value1;
    case 2:
      return exchange.value2;
    case 3:
      return exchange.value3;
    case 4:
      return exchange.value4;
    case 5:
      return exchange.value5;
  }
  return exchange.moreValues![index - kInlineHeaderValues];
}

function shapedValue(exchange: Exchange, index: number): $Node.HttpHeaderValue {
  const oddMask = exchange.oddMask;
  if (oddMask !== 0 && (oddMask & (1 << index)) !== 0) return exchange.oddValues![index] as $Node.HttpHeaderValue;
  return plainShapedValue(exchange, index);
}

function namesOf(shape: HeaderShape): string[] {
  let names = shape.names;
  if (names === null) {
    names = [];
    const keys: string[] = [];
    for (let index = 0; index < shape.count; index++) {
      const node = shapeAt(shape, index);
      names.push(node.name);
      keys.push(node.key);
    }
    shape.names = names;
    shape.keys = keys;
  }
  return names;
}

function keysOf(shape: HeaderShape): string[] {
  namesOf(shape);
  return shape.keys!;
}

function childOf(parent: HeaderShape, name: string, key: string): HeaderShape | null {
  const children = parent.children;
  for (let i = 0; i < children.length; i++) {
    if (children[i].name === name) return children[i];
  }
  if (headerShapeCount === kMaxHeaderShapes) return null;
  headerShapeCount++;
  const child = new HeaderShape(parent, name, key, bitsOfHeaderKey(key));
  children.push(child);
  return child;
}

function shapeWithout(shape: HeaderShape, index: number): HeaderShape | null {
  let node: HeaderShape | null = index === 0 ? noHeadersShape : shapeAt(shape, index - 1);
  for (let i = index + 1; i < shape.count && node !== null; i++) {
    const old = shapeAt(shape, i);
    node = childOf(node, old.name, old.key);
  }
  return node;
}

function shapeRespelled(shape: HeaderShape, index: number, name: string, key: string): HeaderShape | null {
  let node: HeaderShape | null = childOf(index === 0 ? noHeadersShape : shapeAt(shape, index - 1), name, key);
  for (let i = index + 1; i < shape.count && node !== null; i++) {
    const old = shapeAt(shape, i);
    node = childOf(node, old.name, old.key);
  }
  return node;
}

function removeShapedHeader(exchange: Exchange, name: string, key: string): void {
  const shape = exchange.shape;
  if (shape.count === 0) return;
  const index = indexOfShapedHeader(shape, name);
  if (index < 0) return;
  let without: HeaderShape | null = null;
  if (exchange.oddMask === 0) {
    if (shape.withoutIndex === index) {
      without = shape.without;
    } else {
      without = shapeWithout(shape, index);
      if (without !== null) {
        shape.withoutIndex = index;
        shape.without = without;
      }
    }
  }
  if (without === null) {
    spillHeaders(exchange);
    delete exchange.response[kOutHeaders]![key];
    return;
  }
  const last = shape.count - 1;
  for (let i = index; i < last; i++) putShapedValue(exchange, i, plainShapedValue(exchange, i + 1));
  exchange.shape = without;
  exchange.headerBits = without.bits;
  if (last === 0) exchange.wasEmptied = true;
}

function headerEntriesOf(exchange: Exchange): unknown[] {
  const entries: unknown[] = [];
  const shape = exchange.shape;
  if (shape !== spilledHeadersShape) {
    const names = namesOf(shape);
    const keys = shape.keys!;
    for (let index = 0; index < names.length; index++)
      entries.push(keys[index], names[index], shapedValue(exchange, index));
    return entries;
  }
  const headers = exchange.response[kOutHeaders];
  if (headers !== null && headers !== undefined) {
    for (const key in headers) {
      const entry = headers[key];
      entries.push(key, entry[0], entry[1]);
    }
  }
  return entries;
}

function indexInShape(shape: HeaderShape, key: string): number {
  let node = shape;
  for (let index = shape.count - 1; index >= 0; index--) {
    if (node.key === key) return index;
    node = node.parent;
  }
  return -1;
}

function shapeAt(shape: HeaderShape, index: number): HeaderShape {
  let node = shape;
  for (let n = shape.count - 1; n > index; n--) node = node.parent;
  return node;
}

function spillHeaders(exchange: Exchange): void {
  const shape = exchange.shape;
  if (shape === spilledHeadersShape) return;
  exchange.shape = spilledHeadersShape;
  exchange.headerBits = HEADER_SPILLED;
  const count = shape.count;
  if (count === 0 && !exchange.wasEmptied) return;
  const headers = { __proto__: null } as $Node.OutgoingHttpHeaders;
  for (let index = 0; index < count; index++) {
    const node = shapeAt(shape, index);
    headers[node.key] = [node.name, shapedValue(exchange, index)];
  }
  exchange.response[kOutHeaders] = headers;
}

function spillHeadersOf(message: $Node.OutgoingMessage): void {
  const exchange = message[kExchange];
  if (exchange !== undefined) spillHeaders(exchange);
}

function hasHeaderUnderKey(exchange: Exchange, key: string, bit: number): boolean {
  if (exchange.shape !== spilledHeadersShape) return (exchange.headerBits & bit) !== 0;
  const headers = exchange.response[kOutHeaders];
  return headers !== null && headers[key] !== undefined;
}

function isStrictlyValidValue(message: $Node.OutgoingMessage, name: string, value: number | string): boolean {
  if (typeof value === "number") return true;
  if (!checkInvalidHeaderChar(value, false)) return true;
  if (checkInvalidHeaderChar(value, message._isLenientHeaderValidation())) {
    throw $ERR_INVALID_CHAR("header content", name);
  }
  return false;
}

function storeInDictionary(message: $Node.OutgoingMessage, name: string, value: $Node.HttpHeaderValue): void {
  const field = validatedLowercaseHeaderName(name);
  validateHeaderValueLenient(name, value, message._isLenientHeaderValidation());

  let headers = message[kOutHeaders];
  if (headers === null) message[kOutHeaders] = headers = { __proto__: null } as $Node.OutgoingHttpHeaders;

  headers[field] = [name, value];
}

function storeSpilledHeader(exchange: Exchange, name: string, value: $Node.HttpHeaderValue): void {
  spillHeaders(exchange);
  storeInDictionary(exchange.response, name, value);
}

function storeUnexpectedHeader(
  exchange: Exchange,
  shape: HeaderShape,
  name: string,
  value: $Node.HttpHeaderValue,
): void {
  if (shape === spilledHeadersShape) {
    storeInDictionary(exchange.response, name, value);
    return;
  }
  const key = validatedLowercaseHeaderName(name);
  let isStrictlyValid = false;
  if (typeof value === "string" || typeof value === "number") {
    isStrictlyValid = isStrictlyValidValue(exchange.response, name, value);
  } else {
    validateHeaderValueLenient(name, value, exchange.response._isLenientHeaderValidation());
  }
  const index = indexInShape(shape, key);
  if (index >= 0) {
    if (shapeAt(shape, index).name !== name) {
      const respelled = shapeRespelled(shape, index, name, key);
      if (respelled === null) {
        storeSpilledHeader(exchange, name, value);
        return;
      }
      exchange.shape = respelled;
      if (typeof value === "string") putShapedValue(exchange, index, value);
      else if (typeof value === "number") {
        exchange.holdsNumber = true;
        putShapedValue(exchange, index, value);
      } else putOddValue(exchange, index, value);
      return;
    }
    if (typeof value === "string") {
      shape.againName = name;
      shape.againIndex = index;
      putShapedValue(exchange, index, value);
    } else if (typeof value === "number") {
      exchange.holdsNumber = true;
      putShapedValue(exchange, index, value);
    } else {
      putOddValue(exchange, index, value);
    }
    return;
  }
  const next = shape.count === kMaxShapedHeaders ? null : childOf(shape, name, key);
  if (next === null) {
    storeSpilledHeader(exchange, name, value);
    return;
  }
  shape.nextName = name;
  shape.next = next;
  if (typeof value === "string") {
    if (isStrictlyValid) next.checkedValue = value;
    putShapedValue(exchange, shape.count, value);
  } else if (typeof value === "number") {
    exchange.holdsNumber = true;
    putShapedValue(exchange, shape.count, value);
  } else {
    putOddValue(exchange, shape.count, value);
  }
  exchange.shape = next;
  exchange.headerBits = next.bits;
}

function storeShapedHeader(exchange: Exchange, name: string, value: $Node.HttpHeaderValue): void {
  const shape = exchange.shape;
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (shape.nextName === name && shape.next !== shape) {
    const next = shape.next;
    if (typeof value === "string") {
      if (next.checkedValue !== value && isStrictlyValidValue(exchange.response, name, value)) {
        next.checkedValue = value;
      }
      putShapedValue(exchange, shape.count, value);
      exchange.shape = next;
      exchange.headerBits = next.bits;
      return;
    }
    if (typeof value === "number") {
      putShapedValue(exchange, shape.count, value);
      exchange.holdsNumber = true;
    } else {
      validateHeaderValueLenient(name, value, exchange.response._isLenientHeaderValidation());
      putOddValue(exchange, shape.count, value);
    }
    exchange.shape = next;
    exchange.headerBits = next.bits;
    return;
    // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  } else if (shape.againName === name && shape.againIndex >= 0 && typeof value === "string") {
    if (shape.checkedAgainValue !== value && isStrictlyValidValue(exchange.response, name, value)) {
      shape.checkedAgainValue = value;
    }
    putShapedValue(exchange, shape.againIndex, value);
    return;
  }
  storeUnexpectedHeader(exchange, shape, name, value);
}

function findUnexpectedHeader(shape: HeaderShape, name: string): number {
  const index = indexInShape(shape, lowercaseHeaderName(name));
  const turn = shape.foundTurn;
  if (turn === 0) {
    shape.foundName0 = name;
    shape.foundIndex0 = index;
    shape.foundTurn = 1;
  } else if (turn === 1) {
    shape.foundName1 = name;
    shape.foundIndex1 = index;
    shape.foundTurn = 2;
  } else {
    shape.foundName2 = name;
    shape.foundIndex2 = index;
    shape.foundTurn = 0;
  }
  return index;
}

function indexOfShapedHeader(shape: HeaderShape, name: string): number {
  if (shape.foundName0 === name) return shape.foundIndex0;
  if (shape.foundName1 === name) return shape.foundIndex1;
  if (shape.foundName2 === name) return shape.foundIndex2;
  return findUnexpectedHeader(shape, name);
}

function pushRenderedHeader(
  flat: unknown[],
  message: $Node.OutgoingMessage,
  key: string,
  name: string,
  value: $Node.HttpHeaderValue,
): void {
  if ($isArray(value)) {
    const valueLength = value.length;
    if (
      valueLength >= 2 &&
      (key === "cookie" || (message[kUniqueHeaders] != null && message[kUniqueHeaders].$has(key)))
    ) {
      flat.push(name, value.join("; "));
    } else {
      for (let i = 0; i < valueLength; i++) {
        flat.push(name, String(value[i]));
      }
    }
  } else {
    flat.push(name, String(value));
  }
}

function flatHeadersWithCare(exchange: Exchange): unknown[] {
  const shape = exchange.shape;
  const names = namesOf(shape);
  const keys = shape.keys!;
  const flat: unknown[] = [];
  const oddMask = exchange.oddMask;
  let length = 0;
  for (let index = 0; index < names.length; index++) {
    if (oddMask !== 0 && (oddMask & (1 << index)) !== 0) {
      pushRenderedHeader(flat, exchange.response, keys[index], names[index], shapedValue(exchange, index));
      length = flat.length;
    } else {
      const value = plainShapedValue(exchange, index);
      flat[length] = names[index];
      flat[length + 1] = typeof value === "string" ? value : "" + value;
      length += 2;
    }
  }
  return flat;
}

function flatHeadersOf(exchange: Exchange): unknown[] {
  const shape = exchange.shape;
  if (exchange.holdsNumber || shape.count > kInlineHeaderValues) return flatHeadersWithCare(exchange);
  switch (shape.count) {
    case 0:
      return noHeaders;
    case 1:
      return [shape.name, exchange.value0];
    case 2:
      return [shape.parent.name, exchange.value0, shape.name, exchange.value1];
    case 3: {
      const second = shape.parent;
      return [second.parent.name, exchange.value0, second.name, exchange.value1, shape.name, exchange.value2];
    }
    case 4: {
      const third = shape.parent;
      const second = third.parent;
      return [
        second.parent.name,
        exchange.value0,
        second.name,
        exchange.value1,
        third.name,
        exchange.value2,
        shape.name,
        exchange.value3,
      ];
    }
  }
  const fifth = shape.count === 6 ? shape.parent : shape;
  const fourth = fifth.parent;
  const third = fourth.parent;
  const second = third.parent;
  const flat: unknown[] = [
    second.parent.name,
    exchange.value0,
    second.name,
    exchange.value1,
    third.name,
    exchange.value2,
    fourth.name,
    exchange.value3,
    fifth.name,
    exchange.value4,
  ];
  if (shape.count === 6) flat.push(shape.name, exchange.value5);
  return flat;
}

http.responseRoad.makeExchange = makeExchange;
http.responseRoad.storeHeader = storeShapedHeader;
http.responseRoad.spillHeaders = spillHeaders;
http.responseRoad.hasHeaderUnderKey = hasHeaderUnderKey;
http.responseRoad.flatHeadersOf = flatHeadersOf;
http.responseRoad.headerEntriesOf = headerEntriesOf;
http.responseRoad.pushRenderedHeader = pushRenderedHeader;

const outgoingSetHeader = function setHeader(this: $Node.OutgoingMessage, name: string, value: $Node.HttpHeaderValue) {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("set");
  }
  const exchange = this[kExchange];
  if (exchange !== undefined) storeShapedHeader(exchange, name, value);
  else storeInDictionary(this, name, value);
  return this;
};
OutgoingMessage.prototype.setHeader = outgoingSetHeader;
http.responseRoad.outgoingSetHeader = outgoingSetHeader;

OutgoingMessage.prototype.setHeaders = function setHeaders(
  this: $Node.OutgoingMessage,
  headers: Iterable<[name: string, value: $Node.HttpHeaderValue]> & { keys?: unknown; get?: unknown },
) {
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
  let cookies: (number | string)[] | null = null;

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

OutgoingMessage.prototype.appendHeader = function appendHeader(
  this: $Node.OutgoingMessage,
  name: string,
  value: $Node.HttpHeaderValue,
) {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("append");
  }
  const field = validatedLowercaseHeaderName(name);
  validateHeaderValueLenient(name, value, this._isLenientHeaderValidation());

  const exchange = this[kExchange];
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (exchange !== undefined && exchange.shape !== spilledHeadersShape) {
    const index = indexInShape(exchange.shape, field);
    if (index < 0) return this.setHeader(name, value);
    let existing = shapedValue(exchange, index);
    if (!ArrayIsArray(existing)) {
      existing = [existing as number | string];
      putOddValue(exchange, index, existing);
    }
    if (ArrayIsArray(value)) {
      for (let i = 0, length = value.length; i < length; i++) {
        existing.push(value[i]);
      }
    } else {
      existing.push(value);
    }
    return this;
  }

  const headers = this[kOutHeaders];
  if (headers === null || !headers[field]) {
    return this.setHeader(name, value);
  }

  // Prepare the field for appending, if required
  if (!ArrayIsArray(headers[field][1])) {
    headers[field][1] = [headers[field][1] as number | string];
  }

  const existingValues = headers[field][1] as (number | string)[];
  if (ArrayIsArray(value)) {
    for (let i = 0, length = value.length; i < length; i++) {
      existingValues.push(value[i]);
    }
  } else {
    existingValues.push(value);
  }

  return this;
};

OutgoingMessage.prototype.getHeader = function getHeader(this: $Node.OutgoingMessage, name: string) {
  validateString(name, "name");

  const headers = this[kOutHeaders];
  if (headers === null) {
    const exchange = this[kExchange];
    if (exchange === undefined) return;
    const shape = exchange.shape;
    if (shape.count === 0) return;
    const index = indexOfShapedHeader(shape, name);
    return index >= 0 ? shapedValue(exchange, index) : undefined;
  }

  const entry = headers[lowercaseHeaderName(name)];
  return entry?.[1];
};

// Returns an array of the names of the current outgoing headers.
OutgoingMessage.prototype.getHeaderNames = function getHeaderNames(this: $Node.OutgoingMessage) {
  const exchange = this[kExchange];
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (exchange !== undefined && exchange.shape !== spilledHeadersShape) return keysOf(exchange.shape).slice();
  return this[kOutHeaders] !== null ? ObjectKeys(this[kOutHeaders]) : [];
};

// Returns an array of the names of the current outgoing raw headers.
OutgoingMessage.prototype.getRawHeaderNames = function getRawHeaderNames(this: $Node.OutgoingMessage) {
  const exchange = this[kExchange];
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (exchange !== undefined && exchange.shape !== spilledHeadersShape) return namesOf(exchange.shape).slice();
  const headersMap = this[kOutHeaders];
  if (headersMap === null) return [];

  const values = ObjectValues(headersMap);
  const headers: string[] = Array(values.length);
  // Retain for(;;) loop for performance reasons
  // Refs: https://github.com/nodejs/node/pull/30958
  for (let i = 0, l = values.length; i < l; i++) {
    headers[i] = values[i]![0];
  }

  return headers;
};

// Returns a shallow copy of the current outgoing headers.
OutgoingMessage.prototype.getHeaders = function getHeaders(this: $Node.OutgoingMessage) {
  const headers = this[kOutHeaders];
  const ret = { __proto__: null } as $Node.Dictionary<$Node.HttpHeaderValue>;
  const exchange = this[kExchange];
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (exchange !== undefined && exchange.shape !== spilledHeadersShape) {
    const keys = keysOf(exchange.shape);
    for (let index = 0; index < keys.length; index++) ret[keys[index]] = shapedValue(exchange, index);
    return ret;
  }
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

OutgoingMessage.prototype.hasHeader = function hasHeader(this: $Node.OutgoingMessage, name: string) {
  validateString(name, "name");
  if (this[kOutHeaders] === null) {
    const exchange = this[kExchange];
    if (exchange === undefined) return false;
    const shape = exchange.shape;
    return shape.count !== 0 && indexOfShapedHeader(shape, name) >= 0;
  }
  return !!this[kOutHeaders][lowercaseHeaderName(name)];
};

OutgoingMessage.prototype.removeHeader = function removeHeader(this: $Node.OutgoingMessage, name: string) {
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

  const exchange = this[kExchange];
  if (exchange !== undefined && exchange.shape !== spilledHeadersShape) {
    removeShapedHeader(exchange, name, key);
    return;
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
  get: function (this: $Node.OutgoingMessage) {
    return !!this._header;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableEnded", {
  __proto__: null,
  get: function (this: $Node.OutgoingMessage) {
    return this.finished;
  },
});

ObjectDefineProperty(OutgoingMessage.prototype, "writableNeedDrain", {
  __proto__: null,
  get: function (this: $Node.OutgoingMessage) {
    return !this.destroyed && !this.finished && this[kNeedDrain];
  },
});

const crlf_buf = Buffer.from("\r\n");
OutgoingMessage.prototype.write = function write(
  this: $Node.OutgoingMessage,
  chunk: $Node.HttpChunk,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
) {
  if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }

  const ret = write_(this, chunk, encoding, callback, false);
  if (!ret) this[kNeedDrain] = true;
  return ret;
};

function onError(msg: $Node.OutgoingMessage, err: Error, callback: $Node.HttpWriteCallback) {
  if (msg.destroyed) {
    return;
  }

  process.nextTick(emitErrorNt, msg, err, callback);
}

function emitErrorNt(msg: $Node.OutgoingMessage, err: Error, callback: $Node.HttpWriteCallback) {
  callback(err);
  if (typeof msg.emit === "function" && !msg.destroyed) {
    msg.emit("error", err);
  }
}

function strictContentLength(msg: $Node.OutgoingMessage) {
  return (
    msg.strictContentLength &&
    msg._contentLength != null &&
    msg._hasBody &&
    !msg._removedContLen &&
    !msg.chunkedEncoding &&
    !msg.hasHeader("transfer-encoding")
  );
}

function write_(
  msg: $Node.OutgoingMessage,
  chunk: $Node.HttpChunk,
  encoding: string | null | undefined,
  callback: $Node.HttpWriteCallback | null | undefined,
  fromEnd: boolean,
) {
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

  let len: number | undefined;

  if (msg.strictContentLength) {
    len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;

    const contentLength = msg._contentLength;
    if (
      strictContentLength(msg) &&
      (fromEnd ? msg[kBytesWritten] + len! !== contentLength : msg[kBytesWritten] + len! > contentLength!)
    ) {
      throw $ERR_HTTP_CONTENT_LENGTH_MISMATCH(len! + msg[kBytesWritten], contentLength!);
    }

    msg[kBytesWritten] += len!;
  }

  if (!msg._header) {
    if (fromEnd) {
      len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
      msg._contentLength = len!;
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

  let msgSocket: $Node.HttpSocket | null;
  if (!fromEnd && (msgSocket = msg.socket) && !msgSocket.writableCorked) {
    msgSocket.cork();
    process.nextTick(connectionCorkNT, msgSocket);
  }

  let ret;
  if (msg.chunkedEncoding && chunk.length !== 0) {
    len ??= typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength;
    if (msg[kCorked] && msg._headerSent) {
      msg[kChunkedBuffer].push(chunk, encoding, callback);
      msg[kChunkedLength] += len!;
      ret = msg[kChunkedLength] < msg[kHighWaterMark];
    } else {
      msg._send(len!.toString(16), "latin1", null);
      msg._send(crlf_buf, null, null);
      msg._send(chunk, encoding, null, len);
      ret = msg._send(crlf_buf, null, callback);
    }
  } else {
    ret = msg._send(chunk, encoding, callback, len);
  }

  return ret;
}

function connectionCorkNT(conn: $Node.HttpSocket) {
  conn.uncork();
}

OutgoingMessage.prototype.addTrailers = function addTrailers(
  this: $Node.OutgoingMessage,
  headers: Record<string, $Node.HttpHeaderValue> | [name: string, value: $Node.HttpHeaderValue][],
) {
  this._trailer = "";
  const keys = ObjectKeys(headers);
  const isArray = ArrayIsArray(headers);
  const lenient = this._isLenientHeaderValidation();
  // Retain for(;;) loop for performance reasons
  // Refs: https://github.com/nodejs/node/pull/30958
  for (let i = 0, l = keys.length; i < l; i++) {
    let field: string, value: $Node.HttpHeaderValue;
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
    const valueLength = isArrayValue ? (value as (number | string)[]).length : 0;
    if (isArrayValue && valueLength > 1 && (!this[kUniqueHeaders] || !this[kUniqueHeaders].has(field.toLowerCase()))) {
      for (let j = 0, l = valueLength; j < l; j++) {
        if (checkInvalidHeaderChar(value[j], lenient)) {
          throw $ERR_INVALID_CHAR("trailer content", field);
        }
        this._trailer += field + ": " + value[j] + "\r\n";
      }
    } else {
      if (isArrayValue) {
        value = (value as (number | string)[]).join("; ");
      }

      if (checkInvalidHeaderChar(value, lenient)) {
        throw $ERR_INVALID_CHAR("trailer content", field);
      }
      this._trailer += field + ": " + value + "\r\n";
    }
  }
};

function onFinish(outmsg: $Node.OutgoingMessage) {
  if (outmsg?.socket?._hadError) return;
  outmsg.emit("finish");
}

OutgoingMessage.prototype.end = function end(
  this: $Node.OutgoingMessage,
  chunk?: $Node.HttpChunk | null | $Node.HttpWriteCallback,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
) {
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
OutgoingMessage.prototype._finish = function _finish(this: $Node.OutgoingMessage) {
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
OutgoingMessage.prototype._flush = function _flush(this: $Node.OutgoingMessage) {
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

OutgoingMessage.prototype._flushOutput = function _flushOutput(this: $Node.OutgoingMessage, socket: $Node.HttpSocket) {
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

OutgoingMessage.prototype.flushHeaders = function flushHeaders(this: $Node.OutgoingMessage) {
  if (!this._header) {
    this._implicitHeader();
  }

  // Force-flush the headers.
  this._send("");
};

OutgoingMessage.prototype.pipe = function pipe(this: $Node.OutgoingMessage) {
  // OutgoingMessage should be write-only. Piping from it is disabled.
  this.emit("error", $ERR_STREAM_CANNOT_PIPE());
};

OutgoingMessage.prototype[EE.captureRejectionSymbol] = function (
  this: $Node.OutgoingMessage,
  err: Error,
  _event: $Node.EventName,
) {
  this.destroy(err);
};

ObjectDefineProperty(OutgoingMessage.prototype, "_headers", {
  __proto__: null,
  get: deprecate(
    function (this: $Node.OutgoingMessage) {
      return this.getHeaders();
    },
    "OutgoingMessage.prototype._headers is deprecated",
    "DEP0066",
  ),
  set: deprecate(
    function (this: $Node.OutgoingMessage, val: Record<string, $Node.HttpHeaderValue> | null | undefined) {
      spillHeadersOf(this);
      if (val == null) {
        this[kOutHeaders] = null;
      } else if (typeof val === "object") {
        const headers = (this[kOutHeaders] = { __proto__: null } as $Node.OutgoingHttpHeaders);
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
  get(this: $Node.OutgoingMessage) {
    return this.getHeaders();
  },
  set(this: $Node.OutgoingMessage, val: Record<string, $Node.HttpHeaderValue> | null | undefined) {
    if (val == null) {
      this[kOutHeaders] = null;
    } else if (typeof val === "object") {
      this[kOutHeaders] = { __proto__: null } as $Node.OutgoingHttpHeaders;
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
    function (this: $Node.OutgoingMessage) {
      spillHeadersOf(this);
      const headers = this[kOutHeaders];
      if (headers !== null) {
        const out = { __proto__: null } as $Node.Dictionary<string>;
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
    function (this: $Node.OutgoingMessage, val: Record<string, string> | null | undefined) {
      if (typeof val === "object" && val !== null) {
        spillHeadersOf(this);
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
  kRejectNonStandardBodyWrites,
  parseUniqueHeadersOption,
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage,
  FakeSocket,
} as const;
