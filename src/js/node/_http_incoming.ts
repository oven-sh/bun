import { Readable, finished } from "node:stream";
import { assignHeadersFast, eofInProgress, FakeSocket, headersTuple, kEmptyObject, kFakeSocket, kHandle, NodeHTTPBodyReadState, NodeHTTPIncomingRequestType, NodeHTTPResponseAbortEvent, setRequestTimeout, STATUS_CODES, statusCodeSymbol, statusMessageSymbol, swapIsNextIncomingMessageHTTPS, webRequestOrResponse } from "internal/http/share";

const kInternalRequest = Symbol("kInternalRequest");
const typeSymbol = Symbol("type");
const reqSymbol = Symbol("req");
const bodyStreamSymbol = Symbol("bodyStream");
const noBodySymbol = Symbol("noBody");
const abortedSymbol = Symbol("aborted");

export function readStart(socket) {
  if (socket && !socket._paused && socket.readable)
    socket.resume();
}

export function readStop(socket) {
  if (socket)
    socket.pause();
}

function onIncomingMessagePauseNodeHTTPResponse(this: IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) {
    const paused = handle.pause();
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

function emitEOFIncomingMessageOuter(self) {
  self.push(null);
  self.complete = true;
}

function emitEOFIncomingMessage(self) {
  self[eofInProgress] = true;
  process.nextTick(emitEOFIncomingMessageOuter, self);
}

export type IncomingMessage = any; // wehh
export function IncomingMessage(req, defaultIncomingOpts): void {
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
    this[kFakeSocket] = arguments[7];
    Readable.$call(this);

    // If there's a body, pay attention to pause/resume events
    if (arguments[6]) {
      this.on("pause", onIncomingMessagePauseNodeHTTPResponse);
      this.on("resume", onIncomingMessageResumeNodeHTTPResponse);
    }
  } else {
    this[noBodySymbol] = false;
    Readable.$call(this);
    var { [typeSymbol]: type, [reqSymbol]: nodeReq } = defaultIncomingOpts || {};

    this[webRequestOrResponse] = req;
    this[typeSymbol] = type;
    this[bodyStreamSymbol] = undefined;
    this[statusMessageSymbol] = (req as Response)?.statusText || null;
    this[statusCodeSymbol] = (req as Response)?.status || 200;

    if (type === NodeHTTPIncomingRequestType.FetchRequest || type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!assignHeaders(this, req)) {
        this[kFakeSocket] = req;
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

    if (swapIsNextIncomingMessageHTTPS(false)) {
      this.socket.encrypted = true;
    }
  }

  this._readableState.readingMore = true;
}

function requestHasNoBody(method, req) {
  if ("GET" === method || "HEAD" === method || "TRACE" === method || "CONNECT" === method || "OPTIONS" === method)
    return true;
  const headers = req?.headers;
  const contentLength = headers?.["content-length"];
  if (!parseInt(contentLength, 10)) return true;

  return false;
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
  _read(size) {
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

      const socket = this[kFakeSocket];
      if (socket && !socket.destroyed && shouldEmitAborted) {
        socket.destroy(err);
      }
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
    return (this[kFakeSocket] ??= new FakeSocket());
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
  get httpVersion() {
    return "1.1";
  },
  set httpVersion(value) {
    // noop
  },
  get httpVersionMajor() {
    return 1;
  },
  set httpVersionMajor(value) {
    // noop
  },
  get httpVersionMinor() {
    return 1;
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
    this.take;
    const req = this[kHandle] || this[webRequestOrResponse];

    if (req) {
      setRequestTimeout(req, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  },
  get socket() {
    return (this[kFakeSocket] ??= new FakeSocket());
  },
  set socket(value) {
    this[kFakeSocket] = value;
  },
} satisfies typeof import("node:http").IncomingMessage.prototype;
IncomingMessage.prototype = IncomingMessagePrototype;
$setPrototypeDirect.$call(IncomingMessage, Readable);

function assignHeadersSlow(object, req) {
  const headers = req.headers;
  var outHeaders = Object.create(null);
  const rawHeaders: string[] = [];
  var i = 0;
  for (let key in headers) {
    var originalKey = key;
    var value = headers[originalKey];

    key = key.toLowerCase();

    if (key !== "set-cookie") {
      value = String(value);
      $putByValDirect(rawHeaders, i++, originalKey);
      $putByValDirect(rawHeaders, i++, value);
      outHeaders[key] = value;
    } else {
      if ($isJSArray(value)) {
        outHeaders[key] = value.slice();

        for (let entry of value) {
          $putByValDirect(rawHeaders, i++, originalKey);
          $putByValDirect(rawHeaders, i++, entry);
        }
      } else {
        value = String(value);
        outHeaders[key] = [value];
        $putByValDirect(rawHeaders, i++, originalKey);
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
