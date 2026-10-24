// Hardcoded module "node:_http_incoming"
// This is a port of Node.js's lib/_http_incoming.js adapted so that the
// native Bun.serve-based node:http server can construct IncomingMessage
// instances directly from its native handle (the `kHandle` constructor form).
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_incoming.js
const Readable = require("internal/streams/readable");
// callback-style stream.finished (returns a cleanup function)
const finished = require("internal/streams/end-of-stream");
const streamState = require("internal/streams/state");
const { advanceFlags, addFlags, removeFlags, isReadableState, internals, createUnreadByteState } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const EventEmitterPrototype = require("node:events").prototype;
const kDecoderValue: typeof streamState.kDecoderValue = streamState.kDecoderValue;
const { errorOrDestroy } = require("internal/streams/destroy");
const shared = require("internal/shared");
const {
  nextTick: originalNextTick,
  enqueueTick1,
  queueTick1,
  queueTick2,
  queueTick3,
  ring,
  ticksAreUnseen,
  ticksAreUnhooked,
} = require("internal/process/next_tick_queue");

const http = require("internal/http");
const {
  emitErrorNextTickIfErrorListenerNT,
  NodeHTTPBodyReadState,
  NodeHTTPResponseAbortEvent,
  emitEOFIncomingMessage,
  emitEOFIncomingMessageOuter,
  clearServerParserIncoming,
  onDataIncomingMessage,
  takeRequestTrailers,
} = http;
// A symbol taken out of a pattern is a plain `symbol` for the type checker, and what it keys is untyped.
const kAutoDestroyed: typeof shared.kAutoDestroyed = shared.kAutoDestroyed;
const kCapture: typeof shared.kCapture = shared.kCapture;
const kShapeMode: typeof shared.kShapeMode = shared.kShapeMode;
const abortedSymbol: typeof http.abortedSymbol = http.abortedSymbol;
const eofInProgress: typeof http.eofInProgress = http.eofInProgress;
const kHandle: typeof http.kHandle = http.kHandle;
const kHandoffResponse: typeof http.kHandoffResponse = http.kHandoffResponse;
const kResumeUnlessFlowing: typeof http.kResumeUnlessFlowing = http.kResumeUnlessFlowing;
const kHeaderSource: typeof http.kHeaderSource = http.kHeaderSource;
const noBodySymbol: typeof http.noBodySymbol = http.noBodySymbol;
const kReqShouldKeepAlive: typeof http.kReqShouldKeepAlive = http.kReqShouldKeepAlive;

const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ProcessNextTick: (callback: (...args: any[]) => void, ...args: unknown[]) => void = process.nextTick;
const constructReadable = internals.constructReadable!;
const resumeOnNextTick = internals.resumeOnNextTick!;
const endOnNextTick = internals.endOnNextTick!;
const preallocatedEvents = internals.preallocatedEvents!;
const finishReadOfNothing = internals.finishReadOfNothing!;
const finishResume = internals.finishResume!;
const readMoreLater = internals.readMoreLater!;
const readMoreOnNextTick = internals.readMoreOnNextTick!;
const emitReadableNow = internals.emitReadableNow!;
const finishEnd = internals.finishEnd!;
const { read, push, resume, removeAllListeners } = internals.readableMethods!;
const { destroy } = internals.destroyMethods!;
const { emit, listenerCount, removeAllListeners: eventEmitterRemoveAllListeners } = shared.originals.eventEmitter!;
const StreamPrototype = Object.getPrototypeOf(Readable.prototype) as { removeAllListeners: unknown };

const kAutoDestroy = 1 << 2;
const kEmitClose = 1 << 3;
const kDestroyed = 1 << 4;
const kClosed = 1 << 5;
const kCloseEmitted = 1 << 6;
const kErrored = 1 << 7;
const kConstructed = 1 << 8;
const kEnded = 1 << 9;
const kEndEmitted = 1 << 10;
const kReading = 1 << 11;
const kSync = 1 << 12;
const kNeedReadable = 1 << 13;
const kEmittedReadable = 1 << 14;
const kReadableListening = 1 << 15;
const kResumeScheduled = 1 << 16;
const kReadingMore = 1 << 18;
const kDataEmitted = 1 << 19;
const kDefaultUTF8Encoding = 1 << 20;
const kDecoder = 1 << 21;
const kEncoding = 1 << 22;
const kHasFlowing = 1 << 23;
const kFlowing = 1 << 24;
const kHasPaused = 1 << 25;
const kDataListening = 1 << 27;

const kFlagsUntouched = kAutoDestroy | kEmitClose | kConstructed | kSync | kReadingMore | kDefaultUTF8Encoding;
const kFlagsResumed = kFlagsUntouched | kHasFlowing | kFlowing | kHasPaused | kResumeScheduled;
const kFlagsReading = (kFlagsResumed | kReading | kNeedReadable) & ~(kSync | kReadingMore | kResumeScheduled);
const kFlagsEnded = (kFlagsReading | kEnded) & ~(kReading | kNeedReadable);
const kFlagsDestroyed = kFlagsEnded | kEndEmitted | kDestroyed;
const kFlagsClosed = kFlagsDestroyed | kClosed;

const kDecoding = kDecoder | kEncoding;
const kBodyResumed = kFlagsResumed | kDataListening;
const kBodyAsked = (kBodyResumed | kReading | kNeedReadable) & ~kReadingMore;
const kBodyReading = kFlagsReading | kDataListening;
const kBodyGiven = (kBodyReading & ~kReading) | kDataEmitted;
const kBodyReadingOn = kBodyGiven | kReading;
const kBodyEnded = (kBodyGiven & ~kNeedReadable) | kEnded;
const kBodyAwaited =
  (kFlagsUntouched | kReadableListening | kNeedReadable | kHasFlowing | kReading) & ~(kSync | kReadingMore);
const kBodyBuffered = (kBodyAwaited & ~(kReading | kNeedReadable)) | kEmittedReadable | kReadingMore;
const kBodyAnnounced = (kBodyBuffered & ~kEmittedReadable) | kNeedReadable;
const kDestroysItself = kAutoDestroy | kConstructed | kEnded | kEndEmitted;
const kDestroysItselfMask = kDestroysItself | kDestroyed | kClosed | kCloseEmitted | kErrored;

const ObjectPrototypeLookupGetter: (this: unknown, name: PropertyKey) => (() => unknown) | undefined = (
  Object.prototype as any
).__lookupGetter__;

const kHeaders = Symbol("kHeaders");
const kHeadersDistinct = Symbol("kHeadersDistinct");
const kHeadersCount = Symbol("kHeadersCount");
// Cache slot for the lazy req.rawHeaders. The bytes live on kHeaderSource
// (never cleared - unlike kHandle - so post-_destroy access still works).
const kRawHeaders = Symbol("kRawHeaders");
const kTrailers = Symbol("kTrailers");
const kTrailersDistinct = Symbol("kTrailersDistinct");
const kTrailersCount = Symbol("kTrailersCount");
const kAbortController = Symbol("kAbortController");

declare global {
  namespace $Node {
    interface IncomingMessage extends Readable {
      /** `null` once the stream destroyer has taken the connection away from the request. */
      socket: HttpSocket | null | undefined;
      connection: HttpSocket | null | undefined;
      client: HttpSocket | null | undefined;
      /** `null` until the parser has filled it in. */
      httpVersionMajor: number | null;
      httpVersionMinor: number | null;
      httpVersion: string | null;
      complete: boolean;
      rawHeaders: string[];
      rawTrailers: string[];
      headers: IncomingHttpHeaders;
      headersDistinct: Dictionary<string[]>;
      trailers: IncomingHttpHeaders;
      trailersDistinct: Dictionary<string[]>;
      joinDuplicateHeaders: boolean | null | undefined;
      upgrade: boolean | null;
      aborted: boolean;
      readonly signal: AbortSignal;
      /** Of a request that a server got. */
      url: string;
      method: string | null;
      /** Of a response that a client got. */
      statusCode: number | null;
      statusMessage: string | null;
      req?: ClientRequest;
      parser?: HTTPParser | HttpServerParserShim | null;
      _consuming: boolean;
      _dumped: boolean;
      _closed: boolean;
      /** Only where something made the message a `Duplex`. */
      writable?: boolean;
      setTimeout(msecs: number, callback?: () => void): this;
      _addHeaderLines(headers: string[] | undefined, n: number): void;
      _addHeaderLine(field: string, value: string, dest: IncomingHttpHeaders): void;
      _addHeaderLineDistinct(field: string, value: string, dest: Dictionary<string[]>): void;
      _dumpAndCloseReadable(): void;
      _dump(): void;
      [kHeaders]: IncomingHttpHeaders | null;
      [kHeadersDistinct]?: Dictionary<string[]>;
      [kHeadersCount]: number;
      [kRawHeaders]: string[] | null;
      [kTrailers]: IncomingHttpHeaders | null;
      [kTrailersDistinct]?: Dictionary<string[]>;
      [kTrailersCount]: number;
      [kAutoDestroyed]: boolean;
      [kAbortController]: AbortController | null;
    }

    type IncomingMessageConstructor = typeof IncomingMessage;
  }
}

function readStart(socket: $Node.HttpSocket | null | undefined) {
  if (socket && !socket._paused && socket.readable) socket.resume();
}

function readStop(socket: $Node.HttpSocket | null | undefined) {
  if (socket) socket.pause();
}

function onIncomingMessageResumeNodeHTTPResponse(this: $Node.IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) handle.resume();
}

function IncomingMessage(
  this: $Node.IncomingMessage,
  socket?: $Node.HttpSocket | null | typeof kHandle,
  nativeUrl?: string,
  nativeMethod?: string,
  nativeHandle?: $Node.NodeHTTPResponse,
  nativeHasBody?: boolean,
  nativeSocket?: $Node.HttpServerSocket,
  nativeHighWaterMark?: number,
) {
  if (socket === kHandle && nativeHighWaterMark !== undefined) {
    this._events = preallocatedEvents();
    this._readableState = createUnreadByteState(nativeHighWaterMark);
    this[kShapeMode] = true;
    this._maxListeners = undefined;
    this[kCapture] = EventEmitterPrototype[kCapture];
    this.socket = nativeSocket;
    this.complete = false;
    this.rawTrailers = [];
    this.upgrade = false;
    this.url = nativeUrl!;
    this.method = nativeMethod!;
    this.client = nativeSocket;
    this[kHandle] = nativeHandle;
    this._consuming = false;
    this._dumped = false;
    this._closed = false;
    this[kHeaders] = null;
    this[kHeadersCount] = 0;
    this[kTrailers] = null;
    this[kTrailersCount] = 0;
    this[abortedSymbol] = false;
    this[eofInProgress] = false;
    this[kReqShouldKeepAlive] = true;
    this[kRawHeaders] = null;
    this[kHeaderSource] = nativeHandle;
    this[noBodySymbol] = !nativeHasBody;
    this[kAutoDestroyed] = false;
    this[kAbortController] = null;
    return;
  }

  const isFromNativeServer = socket === kHandle;
  if (isFromNativeServer) {
    constructReadable(this, nativeSocket ? nativeSocket.readableHighWaterMark : undefined);
    this.socket = nativeSocket;
    this.complete = false;
    this.rawTrailers = [];
    this.upgrade = null;
    this.url = nativeUrl!;
    this.method = nativeMethod!;
    this.client = nativeSocket;
    this[kHandle] = nativeHandle;
  } else {
    let streamOptions;
    if (socket) {
      streamOptions = {
        highWaterMark: socket.readableHighWaterMark,
      };
    }
    Readable.$call(this, streamOptions);
    this.socket = socket;
    this.httpVersionMajor = null;
    this.httpVersionMinor = null;
    this.httpVersion = null;
    this.complete = false;
    this.rawTrailers = [];
    this.joinDuplicateHeaders = false;
    this.upgrade = null;
    this.url = "";
    this.method = null;
    this.statusCode = null;
    this.statusMessage = null;
    this.client = socket;
  }

  this._consuming = false;
  this._dumped = false;
  this._closed = false;
  this[kHeaders] = null;
  this[kHeadersCount] = 0;
  this[kTrailers] = null;
  this[kTrailersCount] = 0;
  this[abortedSymbol] = false;
  this[eofInProgress] = false;
  this[kReqShouldKeepAlive] = undefined;
  this[kRawHeaders] = null;
  this[kHeaderSource] = isFromNativeServer ? nativeHandle : undefined;
  this[kAbortController] = null;
  this[noBodySymbol] = isFromNativeServer && !nativeHasBody;
  this[kAutoDestroyed] = false;
  if (isFromNativeServer) {
    addFlags(this._readableState, kReadingMore);
  } else {
    this.rawHeaders = [];
    this._readableState.readingMore = true;
  }
}
$toClass(IncomingMessage, "IncomingMessage", Readable);
ObjectDefineProperty(IncomingMessage, "length", { __proto__: null, value: 1, configurable: true });
const IncomingMessagePrototype: object = IncomingMessage.prototype;

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

ObjectDefineProperty(IncomingMessage.prototype, "connection", {
  __proto__: null,
  get: function (this: $Node.IncomingMessage) {
    return this.socket;
  },
  set: function (this: $Node.IncomingMessage, val: $Node.HttpSocket | null | undefined) {
    this.socket = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "aborted", {
  __proto__: null,
  get: function (this: $Node.IncomingMessage) {
    return this[abortedSymbol];
  },
  set: function (this: $Node.IncomingMessage, val: boolean) {
    this[abortedSymbol] = val;
  },
});

// Materializes on first read from the bytes captured on the native handle
// (takeRawHeaders). Assignment (the llhttp client path, or user code)
// short-circuits materialization through the setter.
function getRawHeaders(this: $Node.IncomingMessage) {
  let raw = this[kRawHeaders];
  if (raw === null) {
    const source = this[kHeaderSource];
    // The headers the native handle built, if it did, hold the value strings already.
    let built = source != null ? source.takeRawHeaders(this[kHeaders]) : undefined;
    if (built === undefined) built = [];
    raw = this[kRawHeaders] = built;
    this[kHeadersCount] = built.length;
  }
  return raw;
}
ObjectDefineProperty(IncomingMessage.prototype, "rawHeaders", {
  __proto__: null,
  // Node exposes rawHeaders as an enumerable own data property; a prototype
  // accessor can at least stay visible to for-in.
  enumerable: true,
  get: getRawHeaders,
  set: function (this: $Node.IncomingMessage, value: string[]) {
    this[kRawHeaders] = value;
    this[kHeadersCount] = value ? value.length : 0;
  },
});

// Whether a read of `message.rawHeaders` reaches the accessor above, which is not configurable.
function readsRawHeadersThroughAccessor(message: $Node.IncomingMessage): boolean {
  if (ObjectHasOwn(message, "rawHeaders")) return false;
  const parent: object | null = ObjectGetPrototypeOf(message);
  if (parent === IncomingMessagePrototype) return true;
  return parent !== null && ObjectPrototypeLookupGetter.$call(parent, "rawHeaders") === getRawHeaders;
}

ObjectDefineProperty(IncomingMessage.prototype, "headers", {
  __proto__: null,
  get: function (this: $Node.IncomingMessage) {
    let dst = this[kHeaders];
    if (dst === null || !dst) {
      const addHeaderLine = this._addHeaderLine;
      if (this[kRawHeaders] === null && addHeaderLine === _addHeaderLine && readsRawHeadersThroughAccessor(this)) {
        const source = this[kHeaderSource];
        if (source != null) {
          const built = source.headersObject();
          if (built !== undefined) return (this[kHeaders] = built);
        }
      }
      dst = this[kHeaders] = {};

      const src = this.rawHeaders;
      const count = this[kHeadersCount];

      for (let n = 0; n < count; n += 2) {
        addHeaderLine.$call(this, src[n + 0], src[n + 1], dst);
      }
    }
    return dst;
  },
  set: function (this: $Node.IncomingMessage, val: $Node.IncomingHttpHeaders) {
    this[kHeaders] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "headersDistinct", {
  __proto__: null,
  get: function (this: $Node.IncomingMessage) {
    if (!this[kHeadersDistinct]) {
      this[kHeadersDistinct] = { __proto__: null } as $Node.Dictionary<string[]>;

      const src = this.rawHeaders;
      const dst = this[kHeadersDistinct];

      for (let n = 0; n < this[kHeadersCount]; n += 2) {
        this._addHeaderLineDistinct(src[n + 0], src[n + 1], dst);
      }
    }
    return this[kHeadersDistinct];
  },
  set: function (this: $Node.IncomingMessage, val: $Node.Dictionary<string[]>) {
    this[kHeadersDistinct] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "trailers", {
  __proto__: null,
  get: function (this: $Node.IncomingMessage) {
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
  set: function (this: $Node.IncomingMessage, val: $Node.IncomingHttpHeaders) {
    this[kTrailers] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "trailersDistinct", {
  __proto__: null,
  get: function (this: $Node.IncomingMessage) {
    if (!this[kTrailersDistinct]) {
      this[kTrailersDistinct] = { __proto__: null } as $Node.Dictionary<string[]>;

      const src = this.rawTrailers;
      const dst = this[kTrailersDistinct];

      for (let n = 0; n < this[kTrailersCount]; n += 2) {
        this._addHeaderLineDistinct(src[n + 0], src[n + 1], dst);
      }
    }
    return this[kTrailersDistinct];
  },
  set: function (this: $Node.IncomingMessage, val: $Node.Dictionary<string[]>) {
    this[kTrailersDistinct] = val;
  },
});

ObjectDefineProperty(IncomingMessage.prototype, "signal", {
  __proto__: null,
  configurable: true,
  get: function (this: $Node.IncomingMessage) {
    if (this[kAbortController] === null) {
      const ac: AbortController = new AbortController();
      this[kAbortController] = ac;
      if (this.destroyed) {
        ac.abort();
      } else {
        this.once("close", function () {
          ac.abort();
        });
      }
    }
    return this[kAbortController]!.signal;
  },
});

// Like Node.js: req.setTimeout configures the inactivity timeout of the
// underlying socket; the 'timeout' event itself reaches the request through
// the server's socket timeout handling.
IncomingMessage.prototype.setTimeout = function setTimeout(
  this: $Node.IncomingMessage,
  msecs: number,
  callback?: () => void,
) {
  if (callback) this.on("timeout", callback);
  this.socket?.setTimeout!(msecs);
  return this;
};

function resumeConnection(req: $Node.IncomingMessage) {
  const socket = req.socket;
  if (socket && socket.readable) resumeReadableConnection(req, socket);
}

function resumeReadableConnection(req: $Node.IncomingMessage, socket: $Node.HttpSocket) {
  if (req.upgrade || socket[kHandoffResponse] !== undefined) {
    ("unlikely");
    // Upgrade request with a body (Node 26 semantics): reading the request must not flip the raw socket into flowing mode - tunnel bytes pushed to the socket before the 'upgrade' listener attaches its own 'data' handler would be discarded by a flowing stream with no readers.
    onIncomingMessageResumeNodeHTTPResponse.$call(req);
  } else if (!socket._paused) {
    const resumeUnlessFlowing = socket[kResumeUnlessFlowing];
    if (resumeUnlessFlowing !== undefined) resumeUnlessFlowing.$call(socket);
    else {
      ("unlikely");
      socket.resume();
    }
  }
}

const incomingMessageRead = function _read(this: $Node.IncomingMessage, _n: number) {
  if (!this._consuming) {
    const state = this._readableState;
    if (isReadableState(state)) removeFlags(state, kReadingMore);
    else {
      ("unlikely");
      this._readableState.readingMore = false;
    }
    this._consuming = true;
  }

  const handle = this[kHandle];
  if (!handle) {
    ("unlikely");
    // We actually do almost nothing here, because the parserOnBody
    // function fills up our internal buffer directly.  However, we
    // do need to unpause the underlying socket so that it flows.
    const socket = this.socket;
    if (socket && socket.readable) readStart(socket);
    return;
  }

  // Native server path.
  resumeConnection(this);

  if (this[eofInProgress]) {
    // There is a nextTick pending that will emit EOF
    return;
  }

  if (this[noBodySymbol]) {
    emitEOFIncomingMessage(this);
    return;
  }

  const bodyReadState = handle.hasBody;

  // A dumped or aborted request is not complete: it ends only at its real last chunk, like Node.
  if ((bodyReadState & NodeHTTPBodyReadState.done) !== 0 || bodyReadState === NodeHTTPBodyReadState.none) {
    emitEOFIncomingMessage(this);
  }

  if (!handle.ondata) {
    handle.ondata = onBodyData.bind(this);
  }
};
IncomingMessage.prototype._read = incomingMessageRead;

// It's possible that the socket will be destroyed, and removed from
// any messages, before ever calling this.  In that case, just skip
// it, since something else is destroying this connection anyway.
const incomingMessageDestroy = function _destroy(
  this: $Node.IncomingMessage,
  err: Error | null,
  cb: $Node.ErrorCallback,
) {
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
    if (shouldEmitAborted) {
      // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
      if (!handle.finished && this.socket) {
        http.responseRoad.sendWhatIsHeld?.(this.socket._httpMessage as $Node.ServerResponse | null | undefined);
        handle.abort();
      }
      const socket = this.socket;
      if (socket && !socket.destroyed) {
        socket.destroy(err);
      }
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
IncomingMessage.prototype._destroy = incomingMessageDestroy;

function onFinishedAfterDestroy(
  this: $Node.IncomingMessage,
  state: { cleanup: undefined | (() => void) },
  err: Error | null,
  cb: $Node.ErrorCallback,
  e?: Error | null,
) {
  if (e?.code === "ERR_STREAM_PREMATURE_CLOSE") {
    e = null;
  }
  state.cleanup!();
  process.nextTick(onError, this, e || err, cb);
}

IncomingMessage.prototype._addHeaderLines = _addHeaderLines;
function _addHeaderLines(this: $Node.IncomingMessage, headers: string[] | undefined, n: number) {
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
function matchKnownFields(field: string, lowercased?: boolean): string {
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
//
// Bun__NodeHTTP__buildHeadersObject (NodeHTTP.cpp) builds what this makes of a
// request that names no header twice. A change to what one occurrence of a
// field becomes has to be made there as well.
IncomingMessage.prototype._addHeaderLine = _addHeaderLine;
function _addHeaderLine(this: $Node.IncomingMessage, field: string, value: string, dest: $Node.IncomingHttpHeaders) {
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
      dest[field]! += ", " + value;
    }
  } else if (dest[field] === undefined) {
    // Drop duplicates
    dest[field] = value;
  }
}

IncomingMessage.prototype._addHeaderLineDistinct = _addHeaderLineDistinct;
function _addHeaderLineDistinct(field: string, value: string, dest: $Node.Dictionary<string[]>) {
  field = field.toLowerCase();
  if (!dest[field]) {
    dest[field] = [value];
  } else {
    dest[field].push(value);
  }
}

IncomingMessage.prototype._dumpAndCloseReadable = function _dumpAndCloseReadable(this: $Node.IncomingMessage) {
  this._dumped = true;
  this._readableState.ended = true;
  this._readableState.endEmitted = true;
  this._readableState.destroyed = true;
  this._readableState.closed = true;
  this._readableState.closeEmitted = true;
};

// Call this instead of resume() if we want to just
// dump all the data to /dev/null
const dump = function _dump(this: $Node.IncomingMessage) {
  if (!this._dumped) {
    this._dumped = true;
    // If there is buffered data, it may trigger 'data' events.
    // Remove 'data' event listeners explicitly.
    this.removeAllListeners("data");
    if (endsUnwatched(this)) return;
    // ondata stays armed: it drops the chunks and still delivers the last one, which completes the request.
    this.resume();
  }
};
IncomingMessage.prototype._dump = dump;

function isUnheard(req: $Node.IncomingMessage, name: string) {
  if (req.emit !== emit) return false;
  // A stream whose `_events` are preallocated has no `_eventsCount` of its own until a listener is added, so the count is not what is asked first.
  const events = req._events;
  if (events === undefined) return req._eventsCount === 0;
  return events[name] === undefined;
}

function endsUnwatched(req: $Node.IncomingMessage) {
  if (!req[noBodySymbol] || req.resume !== resume) {
    return false;
  }
  const state = req._readableState;
  if (!advanceFlags(state, kFlagsUntouched, kFlagsResumed)) return false;
  queueTick2(resumeUnwatched, req, state);
  return true;
}

function resumeUnwatched(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  if (
    !req[kHandle] ||
    req._consuming ||
    req[eofInProgress] ||
    req.read !== read ||
    req._read !== incomingMessageRead ||
    req._readableState !== state ||
    !isUnheard(req, "resume") ||
    !advanceFlags(state, kFlagsResumed, kFlagsReading)
  ) {
    ("unlikely");
    return resumeOnNextTick(req, state);
  }
  req._consuming = true;
  resumeConnection(req);
  req[eofInProgress] = true;
  if (ring.read === ring.write && ticksAreUnhooked()) endUnwatched(req);
  else queueTick1(endUnwatched, req);
}

function endUnwatched(req: $Node.IncomingMessage) {
  const state = req._readableState;
  if (
    req.push !== push ||
    req.read !== read ||
    !isUnheard(req, "readable") ||
    !advanceFlags(state, kFlagsReading, kFlagsEnded)
  ) {
    ("unlikely");
    return emitEOFIncomingMessageOuter(req);
  }
  req.complete = true;
  const parser = req.socket?.parser;
  const held = parser != null && parser.incoming === req ? parser : undefined;
  if (ring.read === ring.write && ticksAreUnhooked()) destroyUnwatched(req, state, held);
  else queueTick3(destroyUnwatched, req, state, held);
}

function destroyUnwatched(
  req: $Node.IncomingMessage,
  state: $Node.ReadableState,
  parser: $Node.HTTPParser | $Node.HttpServerParserShim | undefined,
) {
  try {
    destroyOnNextTick(req, state);
  } finally {
    if (parser !== undefined) clearServerParserIncoming(parser, req);
  }
}

function destroyOnNextTick(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  const handle = req[kHandle];
  if (
    !handle ||
    !req.complete ||
    req.writable ||
    req._writableState ||
    req.destroy !== destroy ||
    req._destroy !== incomingMessageDestroy ||
    req._readableState !== state ||
    !isUnheard(req, "end") ||
    !advanceFlags(state, kFlagsEnded, kFlagsDestroyed)
  ) {
    ("unlikely");
    return endOnNextTick(state, req);
  }
  req[kAutoDestroyed] = true;
  req[kHandle] = undefined;
  handle.onabort = undefined;
  queueTick1(closeUnwatched, req);
}

function mayDumpInPlace(req: $Node.IncomingMessage): boolean {
  return (
    req._readableState[kState] === kFlagsUntouched &&
    req[noBodySymbol] &&
    !req._dumped &&
    req._dump === dump &&
    req.resume === resume &&
    req.removeAllListeners === removeAllListeners
  );
}

function beginDump(req: $Node.IncomingMessage): void {
  req._dumped = true;
  req.removeAllListeners("data");
  req._readableState[kState] = kFlagsResumed | 0;
}

function closeUnwatched(req: $Node.IncomingMessage) {
  if (req.listenerCount !== listenerCount) {
    ("unlikely");
    req.listenerCount("error");
  }
  req._readableState[kState] |= kClosed;
  if (ring.read === ring.write && ticksAreUnseen()) emitCloseUnwatched(req);
  else if (ProcessNextTick === originalNextTick) enqueueTick1(emitCloseUnwatched, req);
  else {
    ("unlikely");
    ProcessNextTick(emitCloseUnwatched, req);
  }
}

function emitCloseUnwatched(req: $Node.IncomingMessage) {
  const state = req._readableState;
  const flags = state[kState] | kCloseEmitted;
  state[kState] = flags;
  if (!isUnheard(req, "close") && (flags & kEmitClose) !== 0) req.emit("close");
}

function takeCloseTick(req: $Node.IncomingMessage): boolean {
  const tick = ring.read!;
  if (
    tick === ring.write ||
    tick.next !== ring.write ||
    tick.callback !== closeUnwatched ||
    tick.first !== req ||
    req.listenerCount !== listenerCount ||
    !isUnheard(req, "close")
  ) {
    return false;
  }
  tick.callback = undefined;
  tick.frame = undefined;
  tick.first = undefined;
  ring.read = tick.next;
  closeUnwatched(req);
  return true;
}

internals.takeRequestCloseTick = takeCloseTick;

function resumeRequestBody(stream: $Node.Readable, state: $Node.ReadableState): boolean {
  const flags = state[kState];
  const req: $Node.IncomingMessage = stream as any;
  if ((flags & ~kDecoding) !== kBodyResumed || state.length !== 0 || req._read !== incomingMessageRead) return false;
  const handle = req[kHandle];
  if (
    !handle ||
    req._consuming ||
    req[eofInProgress] ||
    req[noBodySymbol] ||
    req.read !== read ||
    req._readableState !== state ||
    !isUnheard(req, "resume")
  ) {
    ("unlikely");
    return false;
  }
  const asked = (flags & kDecoding) | kBodyAsked;
  state[kState] = asked;
  req._consuming = true;
  try {
    resumeConnection(req);
    const bodyReadState = handle.hasBody;
    if ((bodyReadState & NodeHTTPBodyReadState.done) !== 0 || bodyReadState === NodeHTTPBodyReadState.none) {
      ("unlikely");
      emitEOFIncomingMessage(req);
    }
    if (!handle.ondata) {
      ("unlikely");
      handle.ondata = onBodyData.bind(req);
    }
  } catch (err) {
    errorOrDestroy(stream, err as Error);
  }
  if (state[kState] === asked && state.length === 0) {
    state[kState] = (flags & kDecoding) | kBodyReading;
  } else {
    ("unlikely");
    finishReadOfNothing(state);
    finishResume(req, state);
  }
  return true;
}

internals.resumeRequestBody = resumeRequestBody;

function onBodyData(this: $Node.IncomingMessage, chunk: Buffer | undefined, isLast: boolean, aborted: number) {
  takeBodyData(this, chunk, isLast, aborted);
}

internals.onRequestBodyData = onBodyData;

function takeBodyData(req: $Node.IncomingMessage, chunk: Buffer | undefined, isLast: boolean, aborted: number) {
  const state = req._readableState;
  const flags = state[kState];
  const word = flags & ~kDecoding;
  if (
    aborted !== NodeHTTPResponseAbortEvent.none ||
    !isLast ||
    chunk === undefined ||
    (word !== kBodyReading && (word !== kBodyAwaited || chunk.length >= state.highWaterMark)) ||
    state.length !== 0 ||
    req._dumped ||
    req.upgrade ||
    req[eofInProgress] ||
    req.push !== push ||
    req.read !== read ||
    req._read !== incomingMessageRead ||
    !ticksAreUnseen()
  ) {
    ("unlikely");
    return onDataIncomingMessage.$call(req, chunk, isLast, aborted);
  }

  // Only the native server hands over a body this way.
  const socket: $Node.HttpServerSocket | null | undefined = req.socket as any;
  socket?._unrefTimer?.();

  state[kState] = flags & ~kReading;
  const data = (flags & kDecoder) !== 0 ? state[kDecoderValue]!.write(chunk) : chunk;
  const given = (flags & kDecoding) | kBodyGiven;
  const length = data.length as number;
  if (length !== 0 && word === kBodyReading) {
    state.awaitDrainWriters = null;
    state[kState] = given;
    req.emit("data", data);
  }
  if (length !== 0 && word === kBodyAwaited) {
    state.length = length;
    state.buffer.push(data);
    state[kState] = (flags & kDecoding) | kBodyBuffered;
    queueTick1(emitReadableNow, req);
    req[eofInProgress] = true;
    queueTick2(finishBufferedBody, req, state);
  } else if (state[kState] === given && state.length === 0) {
    state[kState] = given | kReadingMore;
    req[eofInProgress] = true;
    queueTick2(finishBody, req, state);
  } else {
    ("unlikely");
    readMoreLater(req, state);
    if ((state[kState] & kEnded) !== 0 || (state.length >= state.highWaterMark && state.length !== 0)) {
      const finSent = socket?.[kHandle]?.finSent === true;
      // Nothing reads this body and a pause would hide the peer's FIN: uWS drops the later reads, so that FIN closes the connection.
      if (finSent && !req._consuming) socket![kHandle]!.stopParsing();
      else if (socket && (finSent || !socket.writableEnded)) {
        socket.pause();
        req[kHandle]?.pause();
      }
    }
    emitEOFIncomingMessage(req);
  }
  if (!req.upgrade && socket && !socket._paused && socket.readable) {
    const resumeUnlessFlowing = socket[kResumeUnlessFlowing];
    if (resumeUnlessFlowing !== undefined) resumeUnlessFlowing.$call(socket);
    else {
      ("unlikely");
      socket.resume();
    }
  }
}

function readMoreThenEnd(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  try {
    readMoreOnNextTick(req, state);
  } catch (error) {
    queueTick1(emitEOFIncomingMessageOuter, req);
    throw error;
  }
  emitEOFIncomingMessageOuter(req);
}

function finishBody(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  const flags = state[kState];
  if (
    (flags & ~kDecoding) !== (kBodyGiven | kReadingMore) ||
    state.length !== 0 ||
    !req[kHandle] ||
    req.read !== read ||
    req._read !== incomingMessageRead
  ) {
    ("unlikely");
    return readMoreThenEnd(req, state);
  }
  const asked = flags | kReading | kSync;
  state[kState] = asked;
  try {
    resumeConnection(req);
  } catch (err) {
    const stream: $Node.Readable = req;
    errorOrDestroy(stream, err as Error);
  }
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (state[kState] !== asked || state.length !== 0) {
    ("unlikely");
    finishReadOfNothing(state);
    if (state.length !== 0) return readMoreThenEnd(req, state);
    state[kState] &= ~kReadingMore;
    return emitEOFIncomingMessageOuter(req);
  }
  state[kState] = (flags & kDecoding) | kBodyReadingOn;
  endBody(req, state);
}

function finishBufferedBody(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  const flags = state[kState];
  const length = state.length;
  if (
    (flags & ~kDecoding) !== kBodyAnnounced ||
    length === 0 ||
    length >= state.highWaterMark ||
    !req[kHandle] ||
    req.read !== read ||
    req._read !== incomingMessageRead
  ) {
    ("unlikely");
    return readMoreThenEnd(req, state);
  }
  const asked = flags | kReading | kSync;
  state[kState] = asked;
  try {
    resumeConnection(req);
  } catch (err) {
    const stream: $Node.Readable = req;
    errorOrDestroy(stream, err as Error);
  }
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (state[kState] !== asked || state.length !== length) {
    ("unlikely");
    finishReadOfNothing(state);
    if (state.length !== length) return readMoreThenEnd(req, state);
    state[kState] &= ~kReadingMore;
    return emitEOFIncomingMessageOuter(req);
  }
  state[kState] = (flags | kReading) & ~kReadingMore;
  endBody(req, state);
}

function releaseParserOnNextTick(req: $Node.IncomingMessage) {
  const socket = req.socket;
  if (socket != null) {
    const parser = socket.parser;
    if (parser != null && parser.incoming === req) {
      queueTick2(clearServerParserIncoming, parser, req);
    }
  }
}

function endBody(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  const handle = req[kHandle];
  if (handle === undefined || req.push !== push || req.read !== read) {
    ("unlikely");
    return emitEOFIncomingMessageOuter(req);
  }
  req.complete = true;
  const rawTrailers = takeRequestTrailers(req, handle);
  if (rawTrailers !== undefined) {
    ("unlikely");
    req._addHeaderLines(rawTrailers, rawTrailers.length);
    req.push(null);
    return releaseParserOnNextTick(req);
  }
  const flags = state[kState];
  if ((flags & kDecoder) !== 0) {
    const rest = state[kDecoderValue]!.end();
    if (rest?.length) {
      ("unlikely");
      state.buffer.push(rest);
      state.length += rest.length as number;
    }
  }
  if (state.length !== 0 || (flags & kFlowing) === 0 || !isUnheard(req, "readable")) {
    state[kState] = (flags & ~(kReading | kNeedReadable)) | kEnded | kEmittedReadable;
    emitReadableNow(req);
    return releaseParserOnNextTick(req);
  }
  state[kState] = (flags & kDecoding) | kBodyEnded;
  if (ring.read === ring.write && ticksAreUnseen()) {
    releaseParserOnNextTick(req);
    emitBodyEnd(req, state);
  } else {
    queueTick2(endOnNextTick, state, req);
    releaseParserOnNextTick(req);
  }
}

function emitBodyEnd(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  state[kState] |= kEndEmitted;
  req.emit("end");
  finishEnd(state, req);
}

function destroyEndedRequest(state: $Node.ReadableState, stream: $Node.Readable): boolean {
  const req: $Node.IncomingMessage = stream as any;
  if ((state[kState] & kDestroysItselfMask) !== kDestroysItself || req._destroy !== incomingMessageDestroy)
    return false;
  const handle = req[kHandle];
  if (
    !handle ||
    !req.complete ||
    req.writable ||
    req._writableState ||
    req.destroy !== destroy ||
    req._readableState !== state ||
    !ticksAreUnseen()
  ) {
    ("unlikely");
    return false;
  }
  req[kAutoDestroyed] = true;
  state[kState] |= kDestroyed;
  req[kHandle] = undefined;
  handle.onabort = handle.ondata = undefined;
  const tick = ring.read!;
  if (
    tick !== ring.write &&
    tick.next === ring.write &&
    tick.callback === clearServerParserIncoming &&
    tick.second === req
  ) {
    tick.callback = releaseParserThenClose;
  } else {
    queueTick1(closeUnwatched, req);
  }
  return true;
}

function releaseParserThenClose(parser: $Node.HTTPParser | $Node.HttpServerParserShim, req: $Node.IncomingMessage) {
  clearServerParserIncoming(parser, req);
  closeUnwatched(req);
}

internals.destroyEndedRequest = destroyEndedRequest;

function hasNoListenerAndNoWritableSide(req: $Node.IncomingMessage): boolean {
  return (!ObjectHasOwn(req, "_eventsCount") || req._eventsCount === 0) && !req.writable && !req._writableState;
}

function beginUnseenDump(req: $Node.IncomingMessage): void {
  req._dumped = true;
  req[kShapeMode] = false;
  req._readableState[kState] = kFlagsResumed | 0;
}

function staysUnseen(req: $Node.IncomingMessage): boolean {
  const state = req._readableState;
  return (
    state[kState] === kFlagsResumed &&
    state.length === 0 &&
    req[noBodySymbol] &&
    req._dumped &&
    !req._consuming &&
    !req[eofInProgress] &&
    keepsItsMethods(req)
  );
}

function continueDump(req: $Node.IncomingMessage, state: $Node.ReadableState): void {
  resumeUnwatched(req, state);
}

function queueDump(req: $Node.IncomingMessage, state: $Node.ReadableState): void {
  queueTick2(resumeUnwatched, req, state);
}

function endsUnseen(req: $Node.IncomingMessage): boolean {
  const state = req._readableState;
  return (
    state[kState] === kFlagsUntouched &&
    state.length === 0 &&
    req[noBodySymbol] &&
    !req._dumped &&
    !req._consuming &&
    !req[eofInProgress] &&
    keepsItsMethods(req)
  );
}

function keepsItsMethods(req: $Node.IncomingMessage): boolean {
  return (
    req.emit === emit &&
    req._dump === dump &&
    req.removeAllListeners === removeAllListeners &&
    StreamPrototype.removeAllListeners === eventEmitterRemoveAllListeners &&
    req.resume === resume &&
    req.read === read &&
    req._read === incomingMessageRead &&
    req.push === push &&
    req.destroy === destroy &&
    req._destroy === incomingMessageDestroy &&
    req.listenerCount === listenerCount &&
    hasNoListenerAndNoWritableSide(req)
  );
}

function endUnseen(req: $Node.IncomingMessage): void {
  req._dumped = true;
  req[kShapeMode] = false;
  req._consuming = true;
  req.complete = true;
  req[eofInProgress] = true;
  req[kAutoDestroyed] = true;
  req[kHandle] = undefined;
  req._readableState[kState] = kFlagsClosed | kCloseEmitted;
}

http.requestRoad.endsUnseen = endsUnseen;
http.requestRoad.endUnseen = endUnseen;
http.requestRoad.beginUnseenDump = beginUnseenDump;
http.requestRoad.staysUnseen = staysUnseen;
http.requestRoad.continueDump = continueDump;
http.requestRoad.queueDump = queueDump;
http.requestRoad.mayDumpInPlace = mayDumpInPlace;
http.requestRoad.beginDump = beginDump;

function onError(self: $Node.IncomingMessage, error: Error | null | undefined, cb: $Node.ErrorCallback) {
  // This is to keep backward compatible behavior.
  // An error is emitted only if there are listeners attached to the event.
  if (self.listenerCount("error") === 0) {
    cb();
  } else {
    cb(error);
  }
}

export { IncomingMessage, kReqShouldKeepAlive, readStart, readStop };
