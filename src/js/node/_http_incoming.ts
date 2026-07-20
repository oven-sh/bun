// Hardcoded module "node:_http_incoming"
// This is a port of Node.js's lib/_http_incoming.js adapted so that the
// native Bun.serve-based node:http server can construct IncomingMessage
// instances directly from its native handle (the `kHandle` constructor form).
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_incoming.js
const Readable = require("internal/streams/readable");
// callback-style stream.finished (returns a cleanup function)
const finished = require("internal/streams/end-of-stream");

const {
  abortedSymbol,
  eofInProgress,
  kHandle,
  noBodySymbol,
  typeSymbol,
  NodeHTTPIncomingRequestType,
  fakeSocketSymbol,
  emitErrorNextTickIfErrorListenerNT,
  NodeHTTPBodyReadState,
  emitEOFIncomingMessage,
  NodeHTTPResponseAbortEvent,
  kAbortController,
} = require("internal/http");

const { FakeSocket } = require("internal/http/FakeSocket");

const ObjectDefineProperty = Object.defineProperty;
const ArrayPrototypeSlice = Array.prototype.slice;

const kHeaders = Symbol("kHeaders");
// Cache slot for the server dispatcher's keep-alive decision (stamped once
// per request in _http_server.ts); declared in the constructor so the stamp
// never shape-transitions the request.
const kReqShouldKeepAlive = Symbol("kReqShouldKeepAlive");
const kHeadersDistinct = Symbol("kHeadersDistinct");
const kHeadersCount = Symbol("kHeadersCount");
// Lazy req.rawHeaders: cache slot + the native handle the bytes live on
// (never cleared - unlike kHandle - so post-_destroy access still works).
const kRawHeaders = Symbol("kRawHeaders");
const kHeaderSource = Symbol("kHeaderSource");
const kTrailers = Symbol("kTrailers");
const kTrailersDistinct = Symbol("kTrailersDistinct");
const kTrailersCount = Symbol("kTrailersCount");

function readStart(socket) {
  if (socket && !socket._paused && socket.readable) socket.resume();
}

function readStop(socket) {
  if (socket) socket.pause();
}

function onIncomingMessagePauseNodeHTTPResponse(this: IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) {
    handle.pause();
  }
}

function onIncomingMessageResumeNodeHTTPResponse(this: IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) {
    const resumed = handle.resume();
    if (resumed && resumed !== true) {
      const bodyReadState = handle.hasBody;
      if ((bodyReadState & NodeHTTPBodyReadState.done) !== 0) {
        emitEOFIncomingMessage(this);
      }
      this.push(resumed);
    }
  }
}

/* Abstract base class for ServerRequest and ClientResponse. */
function IncomingMessage(socket) {
  this[abortedSymbol] = false;
  this[eofInProgress] = false;
  this._consuming = false;
  // Flag for when we decide that this message cannot possibly be
  // read by the user, so there's no point continuing to handle it.
  this._dumped = false;
  this.complete = false;
  this._closed = false;
  this[kHeaders] = null;
  this[kReqShouldKeepAlive] = undefined;
  this[kRawHeaders] = null;
  this[kHeaderSource] = null;
  this[kHeadersCount] = 0;
  this[kTrailers] = null;
  this[kTrailersCount] = 0;
  this.rawTrailers = [];
  this[kAbortController] = null;

  if (socket === kHandle) {
    // Native server fast-path: (kHandle, url, method, headers, rawHeaders, handle, hasBody, socket)
    this[typeSymbol] = NodeHTTPIncomingRequestType.NodeHTTPResponse;
    this.url = arguments[1];
    this.method = arguments[2];
    // arguments[3] carries no headers object and arguments[4] no rawHeaders
    // on the native fast path anymore: the raw header bytes stay captured on
    // the native handle and req.rawHeaders / req.headers are materialized by
    // the rawHeaders accessor only when user code reads them.
    this[kHeaderSource] = arguments[5];
    this[kHandle] = arguments[5];
    this[noBodySymbol] = !arguments[6];
    this[fakeSocketSymbol] = arguments[7];
    // Node.js exposes the connection as req.client as well (it predates
    // req.socket and some code still reaches for it).
    this.client = arguments[7];
    this.upgrade = null;
    // Like Node's IncomingMessage: the readable side inherits the connection
    // socket's highWaterMark (which carries createServer({ highWaterMark })).
    Readable.$call(this, arguments[7] ? { highWaterMark: arguments[7].readableHighWaterMark } : undefined);

    // If there's a body, pay attention to pause/resume events
    if (arguments[6]) {
      this.on("pause", onIncomingMessagePauseNodeHTTPResponse);
      this.on("resume", onIncomingMessageResumeNodeHTTPResponse);
    }
  } else {
    // Node.js-style construction from a net.Socket (used by the HTTP client
    // and anything driving the llhttp parser through node:_http_common).
    let streamOptions;

    if (socket) {
      streamOptions = {
        highWaterMark: socket.readableHighWaterMark,
      };
    }

    Readable.$call(this, streamOptions);

    this[fakeSocketSymbol] = socket;

    this.httpVersionMajor = null;
    this.httpVersionMinor = null;
    this.httpVersion = null;
    this.rawHeaders = [];
    this.joinDuplicateHeaders = false;

    this.upgrade = null;

    // request (server) only
    this.url = "";
    this.method = null;

    // response (client) only
    this.statusCode = null;
    this.statusMessage = null;
    this.client = socket;

    this[noBodySymbol] = false;
  }

  this._readableState.readingMore = true;
}
$toClass(IncomingMessage, "IncomingMessage", Readable);

// Defaults observed before the parser (or the native server) fills these in.
IncomingMessage.prototype.httpVersion = "1.1";
IncomingMessage.prototype.httpVersionMajor = 1;
IncomingMessage.prototype.httpVersionMinor = 1;
IncomingMessage.prototype.url = "";
IncomingMessage.prototype.method = null;
IncomingMessage.prototype.statusCode = null;
IncomingMessage.prototype.statusMessage = null;
IncomingMessage.prototype.upgrade = null;
IncomingMessage.prototype.joinDuplicateHeaders = false;

ObjectDefineProperty(IncomingMessage.prototype, "socket", {
  __proto__: null,
  get: function () {
    let socket = this[fakeSocketSymbol];
    if (socket === undefined && this[typeSymbol] === NodeHTTPIncomingRequestType.NodeHTTPResponse) {
      // The native server path historically always exposed a socket object.
      socket = this[fakeSocketSymbol] = new FakeSocket(this);
    }
    // Like Node.js, a bare `new IncomingMessage()` reports an undefined
    // socket (not null) until one is assigned.
    return socket;
  },
  set: function (val) {
    this[fakeSocketSymbol] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "connection", {
  __proto__: null,
  get: function () {
    return this.socket;
  },
  set: function (val) {
    this.socket = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "aborted", {
  __proto__: null,
  get: function () {
    return this[abortedSymbol];
  },
  set: function (val) {
    this[abortedSymbol] = val;
  },
});

// Materializes on first read from the bytes captured on the native handle
// (takeRawHeaders). Assignment (the llhttp client path, or user code)
// short-circuits materialization through the setter.
ObjectDefineProperty(IncomingMessage.prototype, "rawHeaders", {
  __proto__: null,
  // Node exposes rawHeaders as an enumerable own data property; a prototype
  // accessor can at least stay visible to for-in.
  enumerable: true,
  get: function () {
    let raw = this[kRawHeaders];
    if (raw === null) {
      const source = this[kHeaderSource];
      let built = source != null ? source.takeRawHeaders() : undefined;
      if (built === undefined) built = [];
      // Node.js's parser keeps at most server.maxHeadersCount header pairs
      // (parser.maxHeaderPairs); the native parser does not enforce it, so
      // truncate here.
      const maxHeadersCount = this[fakeSocketSymbol]?.server?.maxHeadersCount;
      if (typeof maxHeadersCount === "number" && maxHeadersCount > 0 && built.length > maxHeadersCount * 2) {
        built = ArrayPrototypeSlice.$call(built, 0, maxHeadersCount * 2);
      }
      raw = this[kRawHeaders] = built;
      this[kHeadersCount] = built.length;
    }
    return raw;
  },
  set: function (value) {
    this[kRawHeaders] = value;
    this[kHeadersCount] = value ? value.length : 0;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "headers", {
  __proto__: null,
  get: function () {
    let dst = this[kHeaders];
    if (!dst) {
      dst = this[kHeaders] = {};

      const src = this.rawHeaders;
      const count = this[kHeadersCount];
      const addHeaderLine = this._addHeaderLine;

      for (let n = 0; n < count; n += 2) {
        addHeaderLine.$call(this, src[n + 0], src[n + 1], dst);
      }
    }
    return dst;
  },
  set: function (val) {
    this[kHeaders] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "headersDistinct", {
  __proto__: null,
  get: function () {
    if (!this[kHeadersDistinct]) {
      this[kHeadersDistinct] = { __proto__: null };

      const src = this.rawHeaders;
      const dst = this[kHeadersDistinct];

      for (let n = 0; n < this[kHeadersCount]; n += 2) {
        this._addHeaderLineDistinct(src[n + 0], src[n + 1], dst);
      }
    }
    return this[kHeadersDistinct];
  },
  set: function (val) {
    this[kHeadersDistinct] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "trailers", {
  __proto__: null,
  get: function () {
    if (!this[kTrailers]) {
      this[kTrailers] = {};

      const src = this.rawTrailers;
      const dst = this[kTrailers];

      for (let n = 0; n < this[kTrailersCount]; n += 2) {
        this._addHeaderLine(src[n + 0], src[n + 1], dst);
      }
    }
    return this[kTrailers];
  },
  set: function (val) {
    this[kTrailers] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "trailersDistinct", {
  __proto__: null,
  get: function () {
    if (!this[kTrailersDistinct]) {
      this[kTrailersDistinct] = { __proto__: null };

      const src = this.rawTrailers;
      const dst = this[kTrailersDistinct];

      for (let n = 0; n < this[kTrailersCount]; n += 2) {
        this._addHeaderLineDistinct(src[n + 0], src[n + 1], dst);
      }
    }
    return this[kTrailersDistinct];
  },
  set: function (val) {
    this[kTrailersDistinct] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "signal", {
  __proto__: null,
  configurable: true,
  get: function () {
    if (this[kAbortController] === null) {
      const ac = new AbortController();
      this[kAbortController] = ac;
      if (this.destroyed) {
        ac.abort();
      } else {
        this.once("close", function () {
          ac.abort();
        });
      }
    }
    return this[kAbortController].signal;
  },
});

// Like Node.js: req.setTimeout configures the inactivity timeout of the
// underlying socket; the 'timeout' event itself reaches the request through
// the server's socket timeout handling.
IncomingMessage.prototype.setTimeout = function setTimeout(msecs, callback) {
  if (callback) this.on("timeout", callback);
  this.socket?.setTimeout(msecs);
  return this;
};

IncomingMessage.prototype._read = function _read(_n) {
  if (!this._consuming) {
    this._readableState.readingMore = false;
    this._consuming = true;
  }

  const handle = this[kHandle];
  if (!handle) {
    // We actually do almost nothing here, because the parserOnBody
    // function fills up our internal buffer directly.  However, we
    // do need to unpause the underlying socket so that it flows.
    const socket = this.socket;
    if (socket && socket.readable) readStart(socket);
    return;
  }

  // Native server path.
  const socket = this.socket;
  if (socket && socket.readable) {
    if (this.upgrade) {
      // Upgrade request with a body (Node 26 semantics): reading the request
      // must not flip the raw socket into flowing mode - tunnel bytes pushed
      // to the socket before the 'upgrade' listener attaches its own 'data'
      // handler would be discarded by a flowing stream with no readers.
      // Resume the native body source directly instead.
      onIncomingMessageResumeNodeHTTPResponse.$call(this);
    } else {
      socket.resume();
    }
  }

  if (this[eofInProgress]) {
    // There is a nextTick pending that will emit EOF
    return;
  }

  if (this[noBodySymbol]) {
    emitEOFIncomingMessage(this);
    return;
  }

  const bodyReadState = handle.hasBody;

  if (
    (bodyReadState & NodeHTTPBodyReadState.done) !== 0 ||
    bodyReadState === NodeHTTPBodyReadState.none ||
    this._dumped
  ) {
    emitEOFIncomingMessage(this);
  }

  if ((bodyReadState & NodeHTTPBodyReadState.hasBufferedDataDuringPause) !== 0) {
    const drained = handle.drainRequestBody();
    if (drained && !this._dumped) {
      this.push(drained);
    }
  }

  if (!handle.ondata) {
    handle.ondata = onDataIncomingMessage.bind(this);
    handle.hasCustomOnData = false;
  }
};

function onDataIncomingMessage(
  this: import("node:http").IncomingMessage,
  chunk,
  isLast,
  aborted: NodeHTTPResponseAbortEvent,
) {
  if (aborted === NodeHTTPResponseAbortEvent.abort) {
    this.destroy();
    return;
  }

  // Incoming request-body bytes are socket activity: push the connection's
  // inactivity timeout (socket.setTimeout / server.timeout) further out, like
  // Node.js does for reads on the socket.
  const socket = this.socket;
  socket?._unrefTimer?.();

  if (chunk && !this._dumped) {
    if (!this.push(chunk)) {
      // Like Node's parserOnBody: pause the connection once the buffer fills.
      // Upgrade-with-body routes through its own handle so the socket's flow
      // state stays with the upgrade listener; _read() balances it.
      if (this.upgrade) this[kHandle]?.pause();
      else if (!socket?.writableEnded) readStop(socket);
    }
  }

  if (isLast) {
    emitEOFIncomingMessage(this);
    // Like Node's parserOnMessageComplete: any readStop above left the shared
    // socket's flowing=false, which would swallow the next request's 'pause'.
    if (!this.upgrade) readStart(socket);
  }
}

// It's possible that the socket will be destroyed, and removed from
// any messages, before ever calling this.  In that case, just skip
// it, since something else is destroying this connection anyway.
IncomingMessage.prototype._destroy = function _destroy(err, cb) {
  const shouldEmitAborted = !this.readableEnded || !this.complete;

  if (shouldEmitAborted) {
    this[abortedSymbol] = true;
    this.emit("aborted");
  }

  const handle = this[kHandle];
  if (handle) {
    // Native server path. The stream destroyer (internal/streams/destroy.ts)
    // assigns `req.socket = null` before calling destroy() to signal that the
    // connection must outlive the request so the response can still reply
    // (node's _destroy null-socket check).
    this[kHandle] = undefined;
    handle.onabort = handle.ondata = undefined;
    if (!handle.finished && shouldEmitAborted && this.socket) {
      handle.abort();
    }
    const socket = this.socket;
    if (socket && !socket.destroyed && shouldEmitAborted) {
      socket.destroy(err);
    }
    if ($isCallable(cb)) {
      emitErrorNextTickIfErrorListenerNT(this, err, cb);
    }
    return;
  }

  // If aborted and the underlying socket is not already destroyed,
  // destroy it.
  // We have to check if the socket is already destroyed because finished
  // does not call the callback when this method is invoked from `_http_client`
  // in `test/parallel/test-http-client-spurious-aborted.js`
  const socket = this.socket;
  if (socket && !socket.destroyed && this.aborted) {
    socket.destroy(err);
    const state = { cleanup: undefined as undefined | (() => void) };
    state.cleanup = finished(socket, onFinishedAfterDestroy.bind(this, state, err, cb));
  } else {
    process.nextTick(onError, this, err, cb);
  }
};

function onFinishedAfterDestroy(this: any, state, err, cb, e) {
  if (e?.code === "ERR_STREAM_PREMATURE_CLOSE") {
    e = null;
  }
  state.cleanup();
  process.nextTick(onError, this, e || err, cb);
}

IncomingMessage.prototype._addHeaderLines = _addHeaderLines;
function _addHeaderLines(this: any, headers, n) {
  if (headers?.length) {
    let dest;
    if (this.complete) {
      this.rawTrailers = headers;
      this[kTrailersCount] = n;
      dest = this[kTrailers];
    } else {
      this.rawHeaders = headers;
      this[kHeadersCount] = n;
      dest = this[kHeaders];
    }

    if (dest) {
      for (let i = 0; i < n; i += 2) {
        this._addHeaderLine(headers[i], headers[i + 1], dest);
      }
    }
  }
}

// This function is used to help avoid the lowercasing of a field name if it
// matches a 'traditional cased' version of a field name. It returns the
// lowercased name; how duplicates of that field must be combined is reported
// out-of-band in `matchedFieldFlag`, which callers read immediately after.
//
// Node encodes that flag as a prefix byte on the returned name
// (https://github.com/nodejs/node/blob/v26.3.0/lib/_http_incoming.js), costing
// a rope allocation plus a resolve and a slice() per header, and forcing a
// fresh string for every list-valued field instead of reusing the interned
// literal. The flag never escapes this file, so carry it in a module slot and
// return the bare name. Behavior is identical.
const kFieldList = 0; // duplicates joined with ", "
const kFieldSetCookie = 1; // duplicates collected into an array
const kFieldCookie = 2; // duplicates joined with "; "
const kFieldUnique = 3; // duplicates dropped (or joined, per joinDuplicateHeaders)
let matchedFieldFlag = kFieldUnique;
function matchKnownFields(field, lowercased) {
  switch (field.length) {
    case 3:
      if (field === "Age" || field === "age") {
        matchedFieldFlag = kFieldUnique;
        return "age";
      }
      break;
    case 4:
      if (field === "Host" || field === "host") {
        matchedFieldFlag = kFieldUnique;
        return "host";
      }
      if (field === "From" || field === "from") {
        matchedFieldFlag = kFieldUnique;
        return "from";
      }
      if (field === "ETag" || field === "etag") {
        matchedFieldFlag = kFieldUnique;
        return "etag";
      }
      if (field === "Date" || field === "date") {
        matchedFieldFlag = kFieldList;
        return "date";
      }
      if (field === "Vary" || field === "vary") {
        matchedFieldFlag = kFieldList;
        return "vary";
      }
      break;
    case 6:
      if (field === "Server" || field === "server") {
        matchedFieldFlag = kFieldUnique;
        return "server";
      }
      if (field === "Cookie" || field === "cookie") {
        matchedFieldFlag = kFieldCookie;
        return "cookie";
      }
      if (field === "Origin" || field === "origin") {
        matchedFieldFlag = kFieldList;
        return "origin";
      }
      if (field === "Expect" || field === "expect") {
        matchedFieldFlag = kFieldList;
        return "expect";
      }
      if (field === "Accept" || field === "accept") {
        matchedFieldFlag = kFieldList;
        return "accept";
      }
      break;
    case 7:
      if (field === "Referer" || field === "referer") {
        matchedFieldFlag = kFieldUnique;
        return "referer";
      }
      if (field === "Expires" || field === "expires") {
        matchedFieldFlag = kFieldUnique;
        return "expires";
      }
      if (field === "Upgrade" || field === "upgrade") {
        matchedFieldFlag = kFieldList;
        return "upgrade";
      }
      break;
    case 8:
      if (field === "Location" || field === "location") {
        matchedFieldFlag = kFieldUnique;
        return "location";
      }
      if (field === "If-Match" || field === "if-match") {
        matchedFieldFlag = kFieldList;
        return "if-match";
      }
      break;
    case 10:
      if (field === "User-Agent" || field === "user-agent") {
        matchedFieldFlag = kFieldUnique;
        return "user-agent";
      }
      if (field === "Set-Cookie" || field === "set-cookie") {
        matchedFieldFlag = kFieldSetCookie;
        return "set-cookie";
      }
      if (field === "Connection" || field === "connection") {
        matchedFieldFlag = kFieldList;
        return "connection";
      }
      break;
    case 11:
      if (field === "Retry-After" || field === "retry-after") {
        matchedFieldFlag = kFieldUnique;
        return "retry-after";
      }
      break;
    case 12:
      if (field === "Content-Type" || field === "content-type") {
        matchedFieldFlag = kFieldUnique;
        return "content-type";
      }
      if (field === "Max-Forwards" || field === "max-forwards") {
        matchedFieldFlag = kFieldUnique;
        return "max-forwards";
      }
      break;
    case 13:
      if (field === "Authorization" || field === "authorization") {
        matchedFieldFlag = kFieldUnique;
        return "authorization";
      }
      if (field === "Last-Modified" || field === "last-modified") {
        matchedFieldFlag = kFieldUnique;
        return "last-modified";
      }
      if (field === "Cache-Control" || field === "cache-control") {
        matchedFieldFlag = kFieldList;
        return "cache-control";
      }
      if (field === "If-None-Match" || field === "if-none-match") {
        matchedFieldFlag = kFieldList;
        return "if-none-match";
      }
      break;
    case 14:
      if (field === "Content-Length" || field === "content-length") {
        matchedFieldFlag = kFieldUnique;
        return "content-length";
      }
      break;
    case 15:
      if (field === "Accept-Encoding" || field === "accept-encoding") {
        matchedFieldFlag = kFieldList;
        return "accept-encoding";
      }
      if (field === "Accept-Language" || field === "accept-language") {
        matchedFieldFlag = kFieldList;
        return "accept-language";
      }
      if (field === "X-Forwarded-For" || field === "x-forwarded-for") {
        matchedFieldFlag = kFieldList;
        return "x-forwarded-for";
      }
      break;
    case 16:
      if (field === "Content-Encoding" || field === "content-encoding") {
        matchedFieldFlag = kFieldList;
        return "content-encoding";
      }
      if (field === "X-Forwarded-Host" || field === "x-forwarded-host") {
        matchedFieldFlag = kFieldList;
        return "x-forwarded-host";
      }
      break;
    case 17:
      if (field === "If-Modified-Since" || field === "if-modified-since") {
        matchedFieldFlag = kFieldUnique;
        return "if-modified-since";
      }
      if (field === "Transfer-Encoding" || field === "transfer-encoding") {
        matchedFieldFlag = kFieldList;
        return "transfer-encoding";
      }
      if (field === "X-Forwarded-Proto" || field === "x-forwarded-proto") {
        matchedFieldFlag = kFieldList;
        return "x-forwarded-proto";
      }
      break;
    case 19:
      if (field === "Proxy-Authorization" || field === "proxy-authorization") {
        matchedFieldFlag = kFieldUnique;
        return "proxy-authorization";
      }
      if (field === "If-Unmodified-Since" || field === "if-unmodified-since") {
        matchedFieldFlag = kFieldUnique;
        return "if-unmodified-since";
      }
      break;
  }
  if (lowercased) {
    matchedFieldFlag = kFieldList;
    return field;
  }
  return matchKnownFields(field.toLowerCase(), true);
}

// Add the given (field, value) pair to the message
//
// Per RFC2616, section 4.2 it is acceptable to join multiple instances of the
// same header with a ', ' if the header in question supports specification of
// multiple values this way. The one exception to this is the Cookie header,
// which has multiple values joined with a '; ' instead. If a header's values
// cannot be joined in either of these ways, we declare the first instance the
// winner and drop the second. Extended header fields (those beginning with
// 'x-') are always joined.
IncomingMessage.prototype._addHeaderLine = _addHeaderLine;
function _addHeaderLine(this: any, field, value, dest) {
  field = matchKnownFields(field);
  const flag = matchedFieldFlag;
  if (flag === kFieldList || flag === kFieldCookie) {
    // Make a delimited list
    if (typeof dest[field] === "string") {
      dest[field] += (flag === kFieldList ? ", " : "; ") + value;
    } else {
      dest[field] = value;
    }
  } else if (flag === kFieldSetCookie) {
    // Array header -- only Set-Cookie at the moment
    if (dest["set-cookie"] !== undefined) {
      dest["set-cookie"].push(value);
    } else {
      dest["set-cookie"] = [value];
    }
  } else if (this.joinDuplicateHeaders) {
    // RFC 9110 https://www.rfc-editor.org/rfc/rfc9110#section-5.2
    // https://github.com/nodejs/node/issues/45699
    // allow authorization multiple fields
    // Make a delimited list
    if (dest[field] === undefined) {
      dest[field] = value;
    } else {
      dest[field] += ", " + value;
    }
  } else if (dest[field] === undefined) {
    // Drop duplicates
    dest[field] = value;
  }
}

IncomingMessage.prototype._addHeaderLineDistinct = _addHeaderLineDistinct;
function _addHeaderLineDistinct(field, value, dest) {
  field = field.toLowerCase();
  if (!dest[field]) {
    dest[field] = [value];
  } else {
    dest[field].push(value);
  }
}

IncomingMessage.prototype._dumpAndCloseReadable = function _dumpAndCloseReadable() {
  this._dumped = true;
  this._readableState.ended = true;
  this._readableState.endEmitted = true;
  this._readableState.destroyed = true;
  this._readableState.closed = true;
  this._readableState.closeEmitted = true;
};

// Call this instead of resume() if we want to just
// dump all the data to /dev/null
IncomingMessage.prototype._dump = function _dump() {
  if (!this._dumped) {
    this._dumped = true;
    // If there is buffered data, it may trigger 'data' events.
    // Remove 'data' event listeners explicitly.
    this.removeAllListeners("data");
    const handle = this[kHandle];
    if (handle) {
      handle.ondata = undefined;
    }
    this.resume();
  }
};

function onError(self, error, cb) {
  // This is to keep backward compatible behavior.
  // An error is emitted only if there are listeners attached to the event.
  if (self.listenerCount("error") === 0) {
    cb();
  } else {
    cb(error);
  }
}

export { IncomingMessage, kReqShouldKeepAlive, onDataIncomingMessage, readStart, readStop };
