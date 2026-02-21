const Readable = require("internal/streams/readable");

const {
  abortedSymbol,
  eofInProgress,
  kHandle,
  noBodySymbol,
  typeSymbol,
  NodeHTTPIncomingRequestType,
  fakeSocketSymbol,
  isAbortError,
  emitErrorNextTickIfErrorListenerNT,
  kEmptyObject,
  getIsNextIncomingMessageHTTPS,
  setIsNextIncomingMessageHTTPS,
  NodeHTTPBodyReadState,
  emitEOFIncomingMessage,
  bodyStreamSymbol,
  statusMessageSymbol,
  statusCodeSymbol,
  webRequestOrResponse,
  NodeHTTPResponseAbortEvent,
  STATUS_CODES,
  assignHeadersFast,
  setRequestTimeout,
  headersTuple,
  webRequestOrResponseHasBodyValue,
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer,
  kAbortController,
} = require("internal/http");

const { FakeSocket } = require("internal/http/FakeSocket");

var defaultIncomingOpts = { type: "request" };
const nop = () => {};

// Map of lowercase header names to their canonical (Title-Case) form.
// Used by assignHeadersSlow to restore proper casing for rawHeaders,
// since the Fetch API normalizes all header names to lowercase.
const canonicalHeaderNames: Record<string, string> = {
  "accept": "Accept",
  "accept-charset": "Accept-Charset",
  "accept-encoding": "Accept-Encoding",
  "accept-language": "Accept-Language",
  "accept-ranges": "Accept-Ranges",
  "access-control-allow-credentials": "Access-Control-Allow-Credentials",
  "access-control-allow-headers": "Access-Control-Allow-Headers",
  "access-control-allow-methods": "Access-Control-Allow-Methods",
  "access-control-allow-origin": "Access-Control-Allow-Origin",
  "access-control-expose-headers": "Access-Control-Expose-Headers",
  "access-control-max-age": "Access-Control-Max-Age",
  "access-control-request-headers": "Access-Control-Request-Headers",
  "access-control-request-method": "Access-Control-Request-Method",
  "age": "Age",
  "authorization": "Authorization",
  "cache-control": "Cache-Control",
  "connection": "Connection",
  "content-disposition": "Content-Disposition",
  "content-encoding": "Content-Encoding",
  "content-language": "Content-Language",
  "content-length": "Content-Length",
  "content-location": "Content-Location",
  "content-range": "Content-Range",
  "content-security-policy": "Content-Security-Policy",
  "content-security-policy-report-only": "Content-Security-Policy-Report-Only",
  "content-type": "Content-Type",
  "cookie": "Cookie",
  "cookie2": "Cookie2",
  "date": "Date",
  "dnt": "DNT",
  "etag": "ETag",
  "expect": "Expect",
  "expires": "Expires",
  "host": "Host",
  "if-match": "If-Match",
  "if-modified-since": "If-Modified-Since",
  "if-none-match": "If-None-Match",
  "if-range": "If-Range",
  "if-unmodified-since": "If-Unmodified-Since",
  "keep-alive": "Keep-Alive",
  "last-modified": "Last-Modified",
  "link": "Link",
  "location": "Location",
  "origin": "Origin",
  "pragma": "Pragma",
  "proxy-authorization": "Proxy-Authorization",
  "range": "Range",
  "referer": "Referer",
  "referrer-policy": "Referrer-Policy",
  "refresh": "Refresh",
  "sec-fetch-dest": "Sec-Fetch-Dest",
  "sec-fetch-mode": "Sec-Fetch-Mode",
  "sec-websocket-accept": "Sec-WebSocket-Accept",
  "sec-websocket-extensions": "Sec-WebSocket-Extensions",
  "sec-websocket-key": "Sec-WebSocket-Key",
  "sec-websocket-protocol": "Sec-WebSocket-Protocol",
  "sec-websocket-version": "Sec-WebSocket-Version",
  "server-timing": "Server-Timing",
  "set-cookie": "Set-Cookie",
  "set-cookie2": "Set-Cookie2",
  "strict-transport-security": "Strict-Transport-Security",
  "te": "TE",
  "trailer": "Trailer",
  "transfer-encoding": "Transfer-Encoding",
  "upgrade": "Upgrade",
  "upgrade-insecure-requests": "Upgrade-Insecure-Requests",
  "user-agent": "User-Agent",
  "vary": "Vary",
  "via": "Via",
  "x-content-type-options": "X-Content-Type-Options",
  "x-dns-prefetch-control": "X-DNS-Prefetch-Control",
  "x-frame-options": "X-Frame-Options",
  "x-xss-protection": "X-XSS-Protection",
};

function assignHeadersSlow(object, req) {
  const headers = req.headers;
  var outHeaders = Object.create(null);
  const rawHeaders: string[] = [];
  var i = 0;
  for (let key in headers) {
    var value = headers[key];
    var lowercaseKey = key.toLowerCase();
    var rawHeaderName = canonicalHeaderNames[lowercaseKey] || key;

    if (lowercaseKey !== "set-cookie") {
      value = String(value);
      $putByValDirect(rawHeaders, i++, rawHeaderName);
      $putByValDirect(rawHeaders, i++, value);
      outHeaders[lowercaseKey] = value;
    } else {
      if ($isJSArray(value)) {
        outHeaders[lowercaseKey] = value.slice();

        for (let entry of value) {
          $putByValDirect(rawHeaders, i++, rawHeaderName);
          $putByValDirect(rawHeaders, i++, entry);
        }
      } else {
        value = String(value);
        outHeaders[lowercaseKey] = [value];
        $putByValDirect(rawHeaders, i++, rawHeaderName);
        $putByValDirect(rawHeaders, i++, value);
      }
    }
  }
  object.headers = outHeaders;
  object.rawHeaders = rawHeaders;
}

function assignHeaders(object, req) {
  // This fast path is an 8% speedup for a "hello world" node:http server, and a 7% speedup for a "hello world" express server
  if (assignHeadersFast(req, object, headersTuple)) {
    const headers = $getInternalField(headersTuple, 0);
    const rawHeaders = $getInternalField(headersTuple, 1);
    $putInternalField(headersTuple, 0, undefined);
    $putInternalField(headersTuple, 1, undefined);
    object.headers = headers;
    object.rawHeaders = rawHeaders;
    return true;
  } else {
    assignHeadersSlow(object, req);
    return false;
  }
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

function IncomingMessage(req, options = defaultIncomingOpts) {
  this[abortedSymbol] = false;
  this[eofInProgress] = false;
  this._consuming = false;
  this._dumped = false;
  this.complete = false;
  this._closed = false;

  // (url, method, headers, rawHeaders, handle, hasBody)
  if (req === kHandle) {
    this[typeSymbol] = NodeHTTPIncomingRequestType.NodeHTTPResponse;
    this.url = arguments[1];
    this.method = arguments[2];
    this.headers = arguments[3];
    this.rawHeaders = arguments[4];
    this[kHandle] = arguments[5];
    this[noBodySymbol] = !arguments[6];
    this[fakeSocketSymbol] = arguments[7];
    Readable.$call(this);

    // If there's a body, pay attention to pause/resume events
    if (arguments[6]) {
      this.on("pause", onIncomingMessagePauseNodeHTTPResponse);
      this.on("resume", onIncomingMessageResumeNodeHTTPResponse);
    }
  } else {
    this[noBodySymbol] = false;
    Readable.$call(this);
    var { [typeSymbol]: type } = options || {};

    this[webRequestOrResponse] = req;
    this[typeSymbol] = type;
    this[bodyStreamSymbol] = undefined;
    const statusText = (req as Response)?.statusText;
    this[statusMessageSymbol] = statusText !== "" ? statusText || null : "";
    this[statusCodeSymbol] = (req as Response)?.status || 200;

    if (type === NodeHTTPIncomingRequestType.FetchRequest || type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!assignHeaders(this, req)) {
        this[fakeSocketSymbol] = req;
      }
    } else {
      // Node defaults url and method to null.
      this.url = "";
      this.method = null;
      this.rawHeaders = [];
    }

    this[noBodySymbol] =
      type === NodeHTTPIncomingRequestType.FetchRequest // TODO: Add logic for checking for body on response
        ? requestHasNoBody(this.method, this)
        : false;

    if (getIsNextIncomingMessageHTTPS()) {
      this.socket.encrypted = true;
      setIsNextIncomingMessageHTTPS(false);
    }
  }

  this._readableState.readingMore = true;
}

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

  if (chunk && !this._dumped) this.push(chunk);

  if (isLast) {
    emitEOFIncomingMessage(this);
  }
}

const IncomingMessagePrototype = {
  constructor: IncomingMessage,
  __proto__: Readable.prototype,
  httpVersion: "1.1",
  _construct(callback) {
    // TODO: streaming
    const type = this[typeSymbol];

    if (type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!webRequestOrResponseHasBodyValue(this[webRequestOrResponse])) {
        this.complete = true;
        this.push(null);
      }
    }

    callback();
  },
  // Call this instead of resume() if we want to just
  // dump all the data to /dev/null
  _dump() {
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
  },
  _read(_size) {
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
  },
  _finish() {
    this.emit("prefinish");
  },
  _destroy: function IncomingMessage_destroy(err, cb) {
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
  },
  get aborted() {
    return this[abortedSymbol];
  },
  set aborted(value) {
    this[abortedSymbol] = value;
  },
  get connection() {
    return (this[fakeSocketSymbol] ??= new FakeSocket(this));
  },
  get statusCode() {
    return this[statusCodeSymbol];
  },
  set statusCode(value) {
    if (!(value in STATUS_CODES)) return;
    this[statusCodeSymbol] = value;
  },
  get statusMessage() {
    return this[statusMessageSymbol];
  },
  set statusMessage(value) {
    this[statusMessageSymbol] = value;
  },
  get httpVersionMajor() {
    const version = this.httpVersion;
    if (version.startsWith("1.")) {
      return 1;
    }
    return 0;
  },
  set httpVersionMajor(value) {
    // noop
  },
  get httpVersionMinor() {
    const version = this.httpVersion;
    if (version.endsWith(".1")) {
      return 1;
    }
    return 0;
  },
  set httpVersionMinor(value) {
    // noop
  },
  get rawTrailers() {
    return [];
  },
  set rawTrailers(value) {
    // noop
  },
  get trailers() {
    return kEmptyObject;
  },
  set trailers(value) {
    // noop
  },
  setTimeout(msecs, callback) {
    void this.take;
    const req = this[kHandle] || this[webRequestOrResponse];

    if (req) {
      setRequestTimeout(req, Math.ceil(msecs / 1000));
      if (typeof callback === "function") this.once("timeout", callback);
    }
    return this;
  },
  get socket() {
    return (this[fakeSocketSymbol] ??= new FakeSocket(this));
  },
  set socket(value) {
    this[fakeSocketSymbol] = value;
  },
} satisfies typeof import("node:http").IncomingMessage.prototype;
IncomingMessage.prototype = IncomingMessagePrototype;
$setPrototypeDirect.$call(IncomingMessage, Readable);

function requestHasNoBody(method, req) {
  if ("GET" === method || "HEAD" === method || "TRACE" === method || "CONNECT" === method || "OPTIONS" === method)
    return true;
  const headers = req?.headers;
  const contentLength = headers?.["content-length"];
  if (!parseInt(contentLength, 10)) return true;

  return false;
}

async function consumeStream(self, reader: ReadableStreamDefaultReader) {
  var done = false,
    value,
    aborted = false;
  try {
    while (true) {
      const result = reader.readMany();
      if ($isPromise(result)) {
        ({ done, value } = await result);
      } else {
        ({ done, value } = result);
      }

      if (self.destroyed || (aborted = self[abortedSymbol])) {
        break;
      }
      if (!self._dumped) {
        for (var v of value) {
          self.push(v);
        }
      }

      if (self.destroyed || (aborted = self[abortedSymbol]) || done) {
        break;
      }
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

function readStart(socket) {
  if (socket && !socket._paused && socket.readable) {
    socket.resume();
  }
}

function readStop(socket) {
  if (socket) {
    socket.pause();
  }
}

export { IncomingMessage, readStart, readStop };
