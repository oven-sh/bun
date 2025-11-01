// Hardcoded module "node:_http_incoming"
const { Readable, finished } = require("node:stream");
const {
  kHandle,
  kEmptyObject,
  STATUS_CODES,
  abortedSymbol,
  eofInProgress,
  typeSymbol,
  NodeHTTPIncomingRequestType,
  noBodySymbol,
  fakeSocketSymbol,
  webRequestOrResponse,
  setRequestTimeout,
  emitEOFIncomingMessage,
  NodeHTTPBodyReadState,
  bodyStreamSymbol,
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer,
  isAbortError,
  emitErrorNextTickIfErrorListenerNT,
  statusCodeSymbol,
  statusMessageSymbol,
  NodeHTTPResponseAbortEvent,
  webRequestOrResponseHasBodyValue,
  kBunServer,
  kAbortController,
} = require("internal/http");
const { FakeSocket } = require("internal/http/FakeSocket");

const ObjectDefineProperty = Object.defineProperty;

const kHeaders = Symbol("kHeaders");
const kHeadersDistinct = Symbol("kHeadersDistinct");
const kHeadersCount = Symbol("kHeadersCount");
const kTrailers = Symbol("kTrailers");
const kTrailersDistinct = Symbol("kTrailersDistinct");
const kTrailersCount = Symbol("kTrailersCount");

const nop = () => {};

function readStart(socket) {
  if (socket && !socket._paused && socket.readable) socket.resume();
}

function readStop(socket) {
  if (socket) socket.pause();
}

/* Abstract base class for ServerRequest and ClientResponse. */
function IncomingMessage(socket) {
  this[Symbol.for("meghan.kind")] = "_http_incoming";

  // BUN: server
  // (symbol, url, method, headers, rawHeaders, handle, hasBody)
  if (socket === kHandle) {
    this[kBunServer] = true;
    this[abortedSymbol] = false;
    this[eofInProgress] = false;
    this._consuming = false;
    this._dumped = false;
    this.complete = false;
    this._closed = false;
    this[typeSymbol] = NodeHTTPIncomingRequestType.NodeHTTPResponse;
    this.url = arguments[1];
    this.method = arguments[2];
    this.headers = arguments[3];
    this.rawHeaders = arguments[4];
    this[kHandle] = arguments[5];
    this[noBodySymbol] = !arguments[6];
    this[fakeSocketSymbol] = arguments[7];
    Readable.$call(this);

    if (arguments[6]) {
      this.on("pause", onIncomingMessagePauseNodeHTTPResponse);
      this.on("resume", onIncomingMessageResumeNodeHTTPResponse);
    }

    this._readableState.readingMore = true;

    this.httpVersion = "1.1";
    this.httpVersionMajor = 1;
    this.httpVersionMinor = 1;
    return;
  }

  this[kBunServer] = false;
  let streamOptions;

  if (socket) {
    streamOptions = {
      highWaterMark: socket.readableHighWaterMark,
    };
  }

  Readable.$call(this, streamOptions);

  this._readableState.readingMore = true;

  this.socket = socket;

  this.httpVersionMajor = null;
  this.httpVersionMinor = null;
  this.httpVersion = null;
  this.complete = false;
  this[kHeaders] = null;
  this[kHeadersCount] = 0;
  this.rawHeaders = [];
  this[kTrailers] = null;
  this[kTrailersCount] = 0;
  this.rawTrailers = [];
  this.joinDuplicateHeaders = false;
  this.aborted = false;

  this.upgrade = null;

  // request (server) only
  this.url = "";
  this.method = null;

  // response (client) only
  this.statusCode = null;
  this.statusMessage = null;
  this.client = socket;

  this._consuming = false;
  // Flag for when we decide that this message cannot possibly be
  // read by the user, so there's no point continuing to handle it.
  this._dumped = false;
}
$toClass(IncomingMessage, "IncomingMessage", Readable);

ObjectDefineProperty(IncomingMessage.prototype, "connection", {
  __proto__: null,
  get: function () {
    if (this[kBunServer]) {
      return (this[fakeSocketSymbol] ??= new FakeSocket(this));
    }
    return this.socket;
  },
  set: function (val) {
    if (this[kBunServer]) {
      this[fakeSocketSymbol] = val;
      return;
    }
    this.socket = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "headers", {
  __proto__: null,
  get: function () {
    if (!this[kHeaders]) {
      this[kHeaders] = {};

      const src = this.rawHeaders;
      const dst = this[kHeaders];

      for (let n = 0; n < this[kHeadersCount]; n += 2) {
        this._addHeaderLine(src[n + 0], src[n + 1], dst);
      }
    }
    return this[kHeaders];
  },
  set: function (val) {
    this[kHeaders] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "headersDistinct", {
  __proto__: null,
  get: function () {
    if (!this[kHeadersDistinct]) {
      this[kHeadersDistinct] = {};

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
    if (this[kBunServer]) {
      return kEmptyObject;
    }
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
    if (this[kBunServer]) {
      return;
    }
    this[kTrailers] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "trailersDistinct", {
  __proto__: null,
  get: function () {
    if (!this[kTrailersDistinct]) {
      this[kTrailersDistinct] = {};

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

IncomingMessage.prototype.setTimeout = function setTimeout(msecs, callback) {
  if (this[kBunServer]) {
    this.take;
    const req = this[kHandle] || this[webRequestOrResponse];
    if (req) {
      setRequestTimeout(req, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  }

  if (callback) this.on("timeout", callback);
  this.socket.setTimeout(msecs);
  return this;
};

IncomingMessage.prototype._read = function _read(n) {
  if (this[kBunServer]) {
    if (!this._consuming) {
      this._readableState.readingMore = false;
      this._consuming = true;
    }

    const socket = this.socket;
    if (socket && socket.readable) {
      //https://github.com/nodejs/node/blob/13e3aef053776be9be262f210dc438ecec4a3c8d/lib/_http_incoming.js#L211-L213
      socket.resume();
    }

    if (this[eofInProgress]) {
      // There is a nextTick pending that will emit EOF
      return;
    }

    let internalRequest;
    if (this[noBodySymbol]) {
      emitEOFIncomingMessage(this);
      return;
    } else if ((internalRequest = this[kHandle])) {
      const bodyReadState = internalRequest.hasBody;

      if (
        (bodyReadState & NodeHTTPBodyReadState.done) !== 0 ||
        bodyReadState === NodeHTTPBodyReadState.none ||
        this._dumped
      ) {
        emitEOFIncomingMessage(this);
      }

      if ((bodyReadState & NodeHTTPBodyReadState.hasBufferedDataDuringPause) !== 0) {
        const drained = internalRequest.drainRequestBody();
        if (drained && !this._dumped) {
          this.push(drained);
        }
      }

      if (!internalRequest.ondata) {
        internalRequest.ondata = onDataIncomingMessage.bind(this);
        internalRequest.hasCustomOnData = false;
      }

      return true;
    } else if (this[bodyStreamSymbol] == null) {
      // If it's all available right now, we skip going through ReadableStream.
      let completeBody = getCompleteWebRequestOrResponseBodyValueAsArrayBuffer(this[webRequestOrResponse]);
      if (completeBody) {
        $assert(completeBody instanceof ArrayBuffer, "completeBody is not an ArrayBuffer");
        $assert(completeBody.byteLength > 0, "completeBody should not be empty");

        // They're ignoring the data. Let's not do anything with it.
        if (!this._dumped) {
          this.push(new Buffer(completeBody));
        }
        emitEOFIncomingMessage(this);
        return;
      }

      const reader = this[webRequestOrResponse].body?.getReader?.() as ReadableStreamDefaultReader;
      if (!reader) {
        emitEOFIncomingMessage(this);
        return;
      }

      this[bodyStreamSymbol] = reader;
      consumeStream(this, reader);
    }
    return;
  }

  if (!this._consuming) {
    this._readableState.readingMore = false;
    this._consuming = true;
  }

  // We actually do almost nothing here, because the parserOnBody
  // function fills up our internal buffer directly.  However, we
  // do need to unpause the underlying socket so that it flows.
  if (this.socket.readable) readStart(this.socket);
};

// It's possible that the socket will be destroyed, and removed from
// any messages, before ever calling this.  In that case, just skip
// it, since something else is destroying this connection anyway.
IncomingMessage.prototype._destroy = function _destroy(err, cb) {
  if (this[kBunServer]) {
    const shouldEmitAborted = !this.readableEnded || !this.complete;

    if (shouldEmitAborted) {
      this[abortedSymbol] = true;
      // IncomingMessage emits 'aborted'.
      // Client emits 'abort'.
      this.emit("aborted");
    }

    // Suppress "AbortError" from fetch() because we emit this in the 'aborted' event
    if (isAbortError(err)) {
      err = undefined;
    }
    var nodeHTTPResponse = this[kHandle];
    if (nodeHTTPResponse) {
      this[kHandle] = undefined;
      nodeHTTPResponse.onabort = nodeHTTPResponse.ondata = undefined;
      if (!nodeHTTPResponse.finished && shouldEmitAborted) {
        nodeHTTPResponse.abort();
      }
      const socket = this.socket;
      if (socket && !socket.destroyed && shouldEmitAborted) {
        socket.destroy(err);
      }
    } else {
      const stream = this[bodyStreamSymbol];
      this[bodyStreamSymbol] = undefined;
      const streamState = stream?.$state;

      if (streamState === $streamReadable || streamState === $streamWaiting || streamState === $streamWritable) {
        stream?.cancel?.().catch(nop);
      }

      const socket = this.socket;
      if (socket && !socket.destroyed && shouldEmitAborted) {
        socket.destroy(err);
      }
    }
    const req = this.req;
    if (req && !this.complete) {
      req[kAbortController]?.abort?.();
    }

    if ($isCallable(cb)) {
      emitErrorNextTickIfErrorListenerNT(this, err, cb);
    }
    return;
  }

  if (!this.readableEnded || !this.complete) {
    this.aborted = true;
    this.emit("aborted");
  }

  // If aborted and the underlying socket is not already destroyed,
  // destroy it.
  // We have to check if the socket is already destroyed because finished
  // does not call the callback when this method is invoked from `_http_client`
  // in `test/parallel/test-http-client-spurious-aborted.js`
  if (this.socket && !this.socket.destroyed && this.aborted) {
    this.socket.destroy(err);
    const cleanup = finished(this.socket, e => {
      if (e?.code === "ERR_STREAM_PREMATURE_CLOSE") {
        e = null;
      }
      cleanup();
      process.nextTick(onError, this, e || err, cb);
    });
  } else {
    process.nextTick(onError, this, err, cb);
  }
};

IncomingMessage.prototype._addHeaderLines = function (headers, n) {
  $assert(!this[kBunServer]);

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
};

// This function is used to help avoid the lowercasing of a field name if it
// matches a 'traditional cased' version of a field name. It then returns the
// lowercased name to both avoid calling toLowerCase() a second time and to
// indicate whether the field was a 'no duplicates' field. If a field is not a
// 'no duplicates' field, a `0` byte is prepended as a flag. The one exception
// to this is the Set-Cookie header which is indicated by a `1` byte flag, since
// it is an 'array' field and thus is treated differently in _addHeaderLines().
// TODO: perhaps http_parser could be returning both raw and lowercased versions
// of known header names to avoid us having to call toLowerCase() for those
// headers.
function matchKnownFields(field, lowercased = false) {
  switch (field.length) {
    case 3:
      if (field === "Age" || field === "age") return "age";
      break;
    case 4:
      if (field === "Host" || field === "host") return "host";
      if (field === "From" || field === "from") return "from";
      if (field === "ETag" || field === "etag") return "etag";
      if (field === "Date" || field === "date") return "\u0000date";
      if (field === "Vary" || field === "vary") return "\u0000vary";
      break;
    case 6:
      if (field === "Server" || field === "server") return "server";
      if (field === "Cookie" || field === "cookie") return "\u0002cookie";
      if (field === "Origin" || field === "origin") return "\u0000origin";
      if (field === "Expect" || field === "expect") return "\u0000expect";
      if (field === "Accept" || field === "accept") return "\u0000accept";
      break;
    case 7:
      if (field === "Referer" || field === "referer") return "referer";
      if (field === "Expires" || field === "expires") return "expires";
      if (field === "Upgrade" || field === "upgrade") return "\u0000upgrade";
      break;
    case 8:
      if (field === "Location" || field === "location") return "location";
      if (field === "If-Match" || field === "if-match") return "\u0000if-match";
      break;
    case 10:
      if (field === "User-Agent" || field === "user-agent") return "user-agent";
      if (field === "Set-Cookie" || field === "set-cookie") return "\u0001";
      if (field === "Connection" || field === "connection") return "\u0000connection";
      break;
    case 11:
      if (field === "Retry-After" || field === "retry-after") return "retry-after";
      break;
    case 12:
      if (field === "Content-Type" || field === "content-type") return "content-type";
      if (field === "Max-Forwards" || field === "max-forwards") return "max-forwards";
      break;
    case 13:
      if (field === "Authorization" || field === "authorization") return "authorization";
      if (field === "Last-Modified" || field === "last-modified") return "last-modified";
      if (field === "Cache-Control" || field === "cache-control") return "\u0000cache-control";
      if (field === "If-None-Match" || field === "if-none-match") return "\u0000if-none-match";
      break;
    case 14:
      if (field === "Content-Length" || field === "content-length") return "content-length";
      break;
    case 15:
      if (field === "Accept-Encoding" || field === "accept-encoding") return "\u0000accept-encoding";
      if (field === "Accept-Language" || field === "accept-language") return "\u0000accept-language";
      if (field === "X-Forwarded-For" || field === "x-forwarded-for") return "\u0000x-forwarded-for";
      break;
    case 16:
      if (field === "Content-Encoding" || field === "content-encoding") return "\u0000content-encoding";
      if (field === "X-Forwarded-Host" || field === "x-forwarded-host") return "\u0000x-forwarded-host";
      break;
    case 17:
      if (field === "If-Modified-Since" || field === "if-modified-since") return "if-modified-since";
      if (field === "Transfer-Encoding" || field === "transfer-encoding") return "\u0000transfer-encoding";
      if (field === "X-Forwarded-Proto" || field === "x-forwarded-proto") return "\u0000x-forwarded-proto";
      break;
    case 19:
      if (field === "Proxy-Authorization" || field === "proxy-authorization") return "proxy-authorization";
      if (field === "If-Unmodified-Since" || field === "if-unmodified-since") return "if-unmodified-since";
      break;
  }
  if (lowercased) {
    return "\u0000" + field;
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
IncomingMessage.prototype._addHeaderLine = function (field, value, dest) {
  $assert(!this[kBunServer]);

  field = matchKnownFields(field);
  const flag = field.charCodeAt(0);
  if (flag === 0 || flag === 2) {
    field = field.slice(1);
    // Make a delimited list
    if (typeof dest[field] === "string") {
      dest[field] += (flag === 0 ? ", " : "; ") + value;
    } else {
      dest[field] = value;
    }
  } else if (flag === 1) {
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
};

IncomingMessage.prototype._addHeaderLineDistinct = function (field, value, dest) {
  $assert(!this[kBunServer]);

  field = field.toLowerCase();
  if (!dest[field]) {
    dest[field] = [value];
  } else {
    dest[field].push(value);
  }
};

// Call this instead of resume() if we want to just
// dump all the data to /dev/null
IncomingMessage.prototype._dump = function _dump() {
  if (this[kBunServer]) {
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
    return;
  }

  if (!this._dumped) {
    this._dumped = true;
    // If there is buffered data, it may trigger 'data' events.
    // Remove 'data' event listeners explicitly.
    this.removeAllListeners("data");
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

// BUN: server extras
ObjectDefineProperty(IncomingMessage.prototype, "socket", {
  get() {
    if (this[kBunServer]) {
      return (this[fakeSocketSymbol] ??= new FakeSocket(this));
    }
    return this.__socket;
  },
  set(value) {
    if (this[kBunServer]) {
      this[fakeSocketSymbol] = value;
      return;
    }
    this.__socket = value;
    return;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "rawTrailers", {
  get() {
    if (this[kBunServer]) {
      return [];
    }
    return this.__rawTrailers;
  },
  set(value) {
    if (this[kBunServer]) {
      return;
    }
    this.__rawTrailers = value;
    return;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "aborted", {
  get() {
    if (this[kBunServer]) {
      return this[abortedSymbol];
    }
    return this.__aborted;
  },
  set(value) {
    if (this[kBunServer]) {
      this[abortedSymbol] = value;
      return;
    }
    this.__aborted = value;
    return;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "statusCode", {
  get() {
    if (this[kBunServer]) {
      return this[statusCodeSymbol];
    }
    return this.__statusCode;
  },
  set(value) {
    if (this[kBunServer]) {
      if (!(value in STATUS_CODES)) return;
      this[statusCodeSymbol] = value;
      return;
    }
    this.__statusCode = value;
    return;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "statusMessage", {
  get() {
    if (this[kBunServer]) {
      return this[statusMessageSymbol];
    }
    return this.__statusMessage;
  },
  set(value) {
    if (this[kBunServer]) {
      this[statusMessageSymbol] = value;
      return;
    }
    this.__statusMessage = value;
    return;
  },
});

IncomingMessage.prototype._construct = function (callback) {
  if (this[kBunServer]) {
    // TODO: streaming
    const type = this[typeSymbol];
    if (type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!webRequestOrResponseHasBodyValue(this[webRequestOrResponse])) {
        this.complete = true;
        this.push(null);
      }
    }
    callback();
    return;
  }
  callback();
};

function onIncomingMessagePauseNodeHTTPResponse(this: import("node:http").IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) {
    handle.pause();
  }
}

function onIncomingMessageResumeNodeHTTPResponse(this: import("node:http").IncomingMessage) {
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

function onDataIncomingMessage(this: import("node:http").IncomingMessage, chunk, isLast, aborted) {
  if (aborted === NodeHTTPResponseAbortEvent.abort) {
    this.destroy();
    return;
  }
  if (chunk && !this._dumped) this.push(chunk);
  if (isLast) emitEOFIncomingMessage(this);
}

async function consumeStream(self, reader: ReadableStreamDefaultReader) {
  var done = false;
  var value;
  var aborted = false;
  try {
    while (true) {
      const result = reader.readMany();
      if ($isPromise(result)) {
        ({ done, value } = await result);
      } else {
        ({ done, value } = result);
      }
      if (self.destroyed || (aborted = self[abortedSymbol])) break;
      if (!self._dumped) for (var v of value) self.push(v);
      if (self.destroyed || (aborted = self[abortedSymbol]) || done) break;
    }
  } catch (err) {
    if (aborted || self.destroyed) return;
    self.destroy(err);
  } finally {
    reader?.cancel?.().catch?.(nop);
  }
  if (!self.complete) {
    emitEOFIncomingMessage(self);
  }
}

export default {
  IncomingMessage,
  readStart,
  readStop,
};
