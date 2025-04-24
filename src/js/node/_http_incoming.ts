// @ts-nocheck
const { Readable } = require("node:stream");
const { Socket } = require("node:net"); // Import Socket for type checking FakeSocket

// Symbols from internal/http
// These should ideally be imported or declared properly in a .d.ts file
const abortedSymbol: unique symbol = Symbol.for("::bunternal::abortedSymbol");
const eofInProgress: unique symbol = Symbol.for("::bunternal::eofInProgress");
const kHandle: unique symbol = Symbol.for("::bunternal::kHandle");
const noBodySymbol: unique symbol = Symbol.for("::bunternal::noBodySymbol");
const typeSymbol: unique symbol = Symbol.for("::bunternal::typeSymbol");
const fakeSocketSymbol: unique symbol = Symbol.for("::bunternal::fakeSocketSymbol");
const bodyStreamSymbol: unique symbol = Symbol.for("::bunternal::bodyStreamSymbol");
const statusMessageSymbol: unique symbol = Symbol.for("::bunternal::statusMessageSymbol");
const statusCodeSymbol: unique symbol = Symbol.for("::bunternal::statusCodeSymbol");
const webRequestOrResponse: unique symbol = Symbol.for("::bunternal::webRequestOrResponse");
const headersTuple: unique symbol = Symbol.for("::bunternal::headersTuple");

// Types/Values from internal/http
// These should ideally be imported or declared properly in a .d.ts file
const {
  // abortedSymbol, // Already declared above
  // eofInProgress, // Already declared above
  // kHandle, // Already declared above
  // noBodySymbol, // Already declared above
  // typeSymbol, // Already declared above
  NodeHTTPIncomingRequestType,
  // fakeSocketSymbol, // Already declared above
  isAbortError,
  emitErrorNextTickIfErrorListenerNT,
  kEmptyObject,
  getIsNextIncomingMessageHTTPS,
  setIsNextIncomingMessageHTTPS,
  NodeHTTPBodyReadState,
  emitEOFIncomingMessage,
  // bodyStreamSymbol, // Already declared above
  // statusMessageSymbol, // Already declared above
  // statusCodeSymbol, // Already declared above
  // webRequestOrResponse, // Already declared above
  NodeHTTPResponseAbortEvent,
  STATUS_CODES,
  assignHeadersFast,
  setRequestTimeout,
  // headersTuple, // Already declared above
  webRequestOrResponseHasBodyValue,
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer,
} = require("internal/http");

const { FakeSocket } = require("internal/http/FakeSocket");

// Define the IncomingMessage interface
interface NodeHTTPResponse {
  pause(): void;
  resume(): any;
  hasBody: number;
  ondata?: (chunk: any, isLast: boolean, aborted: number) => void;
  onabort?: () => void;
  hasCustomOnData?: boolean;
  drainRequestBody(): any;
  abort(): void;
  finished: boolean;
}

interface IncomingMessage extends Readable {
  [abortedSymbol]: boolean;
  [eofInProgress]: boolean;
  _consuming: boolean;
  _dumped: boolean; // Added for TS2339
  complete: boolean;
  _closed: boolean;
  [typeSymbol]: number; // typeof NodeHTTPIncomingRequestType[keyof typeof NodeHTTPIncomingRequestType];
  [kHandle]?: NodeHTTPResponse;
  [noBodySymbol]: boolean;
  [fakeSocketSymbol]?: FakeSocket | Request | Response; // Can hold FakeSocket or the original web request/response
  [webRequestOrResponse]?: Request | Response;
  [bodyStreamSymbol]?: ReadableStreamDefaultReader;
  [statusMessageSymbol]: string | null;
  [statusCodeSymbol]: number;

  // Standard properties
  headers: Record<string, string | string[]>;
  rawHeaders: string[];
  httpVersion: string;
  method: string | null;
  url: string;
  socket: FakeSocket; // Getter returns FakeSocket
  connection: FakeSocket; // Getter returns FakeSocket
  statusCode: number; // Getter/Setter
  statusMessage: string | null; // Getter/Setter
  httpVersionMajor: number; // Getter
  httpVersionMinor: number; // Getter
  rawTrailers: string[]; // Getter
  trailers: Record<string, string>; // Getter
  aborted: boolean; // Getter/Setter

  // Methods
  setTimeout(msecs: number, callback?: () => void): this;
  _dump(): void;

  // Readable overrides are implicitly part of `extends Readable`
  // _read(size: number): void;
  // _destroy(error: Error | null, callback: (error?: Error | null) => void): void;
  // _construct(callback: (error?: Error | null) => void): void;
  // _finish(): void; // Added for completeness, though might not be strictly necessary if base Readable handles it
}


var defaultIncomingOpts = { type: "request" };
const nop = () => {};

function assignHeadersSlow(object: IncomingMessage, req: Request | Response) {
  const headers = req.headers;
  var outHeaders = Object.create(null);
  const rawHeaders: string[] = [];
  var i = 0;
  // @ts-ignore // Headers object might not be iterable directly like this in TS standard libs
  for (let key in headers) {
    var originalKey = key;
    // @ts-ignore // Headers object might not be indexable like this
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

function assignHeaders(object: IncomingMessage, req: Request | Response) {
  // This fast path is an 8% speedup for a "hello world" node:http server, and a 7% speedup for a "hello world" express server
  if (assignHeadersFast(req, object, headersTuple)) {
    const headers = $getInternalField(headersTuple as unknown as InternalFieldObject<[any, any]>, 0);
    const rawHeaders = $getInternalField(headersTuple as unknown as InternalFieldObject<[any, any]>, 1);
    $putInternalField(headersTuple as unknown as InternalFieldObject<[any, any]>, 0, undefined);
    $putInternalField(headersTuple as unknown as InternalFieldObject<[any, any]>, 1, undefined);
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

function IncomingMessage(this: IncomingMessage, req, options = defaultIncomingOpts) {
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
      // This assumes socket is already initialized, which might not be true here.
      // The socket getter initializes it if needed. Let's ensure it's initialized.
      const socket = this.socket;
      socket.encrypted = true;
      setIsNextIncomingMessageHTTPS(false);
    }
  }

  this._readableState.readingMore = true;
}

function onDataIncomingMessage(
  this: IncomingMessage,
  chunk,
  isLast,
  aborted: number, // Fixed TS2749
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
  _construct(this: IncomingMessage, callback) {
    // TODO: streaming
    const type = this[typeSymbol];

    if (type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!webRequestOrResponseHasBodyValue(this[webRequestOrResponse]!)) {
        this.complete = true;
        this.push(null);
      }
    }

    callback();
  },
  // Call this instead of resume() if we want to just
  // dump all the data to /dev/null
  _dump(this: IncomingMessage) {
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
  _read(this: IncomingMessage, _size) {
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
      let completeBody = getCompleteWebRequestOrResponseBodyValueAsArrayBuffer(this[webRequestOrResponse]!);
      if (completeBody) {
        $assert(completeBody instanceof ArrayBuffer, "completeBody is not an ArrayBuffer");
        // Allow empty body
        // $assert(completeBody.byteLength > 0, "completeBody should not be empty");

        // They're ignoring the data. Let's not do anything with it.
        if (!this._dumped) {
          // @ts-ignore // Buffer constructor might not be globally available like this
          this.push(new Buffer(completeBody));
        }
        emitEOFIncomingMessage(this);
        return;
      }

      const reader = this[webRequestOrResponse]!.body?.getReader?.() as ReadableStreamDefaultReader | undefined;
      if (!reader) {
        emitEOFIncomingMessage(this);
        return;
      }

      this[bodyStreamSymbol] = reader;
      consumeStream(this, reader);
    }

    return;
  },
  _finish(this: IncomingMessage) {
    this.emit("prefinish");
  },
  _destroy: function IncomingMessage_destroy(this: IncomingMessage, err, cb) {
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

      if (streamState === $streamReadable || streamState === $streamWaiting /* || streamState === $streamWritable */) { // Writable state check seems wrong for a reader
        stream?.cancel?.().catch(nop);
      }

      const socket = this[fakeSocketSymbol];
      if (socket && !(socket as FakeSocket).destroyed && shouldEmitAborted) {
        (socket as FakeSocket).destroy(err);
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
    // @ts-ignore // FakeSocket might not be directly assignable to Socket
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  get statusCode() {
    return this[statusCodeSymbol];
  },
  set statusCode(value) {
    // Fixed TS2538
    if (!((value as string | number) in STATUS_CODES)) return;
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
  setTimeout(this: IncomingMessage, msecs, callback) {
    const req = this[kHandle] || this[webRequestOrResponse];

    if (req) {
      setRequestTimeout(req, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  },
  get socket() {
    // @ts-ignore // FakeSocket might not be directly assignable to Socket
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  set socket(value) {
    // @ts-ignore // FakeSocket might not be directly assignable to Socket
    this[fakeSocketSymbol] = value;
  },
} as unknown as IncomingMessage; // Cast the prototype object to the instance type

// Assign prototype methods and properties
Object.assign(IncomingMessage.prototype, IncomingMessagePrototype);
// Set up inheritance: IncomingMessage constructor inherits from Readable constructor
Object.setPrototypeOf(IncomingMessage, Readable); // Fixed TS2304

function requestHasNoBody(method: string | null, req: IncomingMessage): boolean {
  if ("GET" === method || "HEAD" === method || "TRACE" === method || "CONNECT" === method || "OPTIONS" === method)
    return true;
  const headers = req?.headers;
  const contentLength = headers?.["content-length"];
  // Check if contentLength is a string or array of strings before parsing
  let lengthValue: string | undefined;
  if (Array.isArray(contentLength)) {
    // Use the last value if multiple headers exist, consistent with Node.js behavior
    lengthValue = contentLength[contentLength.length - 1];
  } else {
    lengthValue = contentLength;
  }
  if (lengthValue === undefined || !parseInt(lengthValue, 10)) return true;

  return false;
}

async function consumeStream(self: IncomingMessage, reader: ReadableStreamDefaultReader) {
  var done = false,
    value,
    aborted = false;
  try {
    while (true) {
      // Use read() instead of readMany() for broader compatibility? Node's adapter uses read().
      // Let's assume readMany() is available and optimized.
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
          // Ensure v is Buffer or Uint8Array before pushing
          // @ts-ignore
          self.push(Buffer.isBuffer(v) ? v : new Buffer(v));
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
    // reader might be null if already cancelled/closed
    reader?.cancel?.().catch?.(nop);
  }

  if (!self.complete) {
    emitEOFIncomingMessage(self);
  }
}

export default {
  IncomingMessage,
};