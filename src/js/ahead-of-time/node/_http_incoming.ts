// What the compiler reads in place of src/js/node/_http_incoming.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 28181b2c5a22f824a8caebb17a1f5a3d65525df1d060b79b1a452932b3f20a1f.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

// Hardcoded module "node:_http_incoming"
// This is a port of Node.js's lib/_http_incoming.js adapted so that the
// native Bun.serve-based node:http server can construct IncomingMessage
// instances directly from its native handle (the `kMadeOverHandle` constructor form).
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_incoming.js
const Readable = require("internal/streams/readable");
const { Stream } = require("internal/streams/legacy");
// callback-style stream.finished (returns a cleanup function)
const finished = require("internal/streams/end-of-stream");
const streamState = require("internal/streams/state");
const { advanceFlags, addFlags, internals, createUnreadByteState } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const EventEmitterPrototype = require("node:events").prototype;
const kDecoderValue: typeof streamState.kDecoderValue = streamState.kDecoderValue;
const { errorOrDestroy } = require("internal/streams/destroy");
const shared = require("internal/shared");
const {
  nextTick: originalNextTick,
  enqueueTick1,
  ticksAreUnhooked,
  queueTick1,
  queueTick2,
  queueTick3,
  ring,
  asyncContext,
  ticksAreUnseen,
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
const kCapture: typeof shared.kCapture = shared.kCapture;
const kShapeMode: typeof shared.kShapeMode = shared.kShapeMode;
const kAutoDestroyed: typeof shared.kAutoDestroyed = shared.kAutoDestroyed;
const abortedSymbol: typeof http.abortedSymbol = http.abortedSymbol;
const kAbortController: typeof http.kAbortController = http.kAbortController;
const eofInProgress: typeof http.eofInProgress = http.eofInProgress;
const kHandle: typeof http.kHandle = http.kHandle;
const kMadeOverHandle: typeof http.kMadeOverHandle = http.kMadeOverHandle;
const kHandoffResponse: typeof http.kHandoffResponse = http.kHandoffResponse;
const kHeaderSource: typeof http.kHeaderSource = http.kHeaderSource;
const noBodySymbol: typeof http.noBodySymbol = http.noBodySymbol;
const kReqShouldKeepAlive: typeof http.kReqShouldKeepAlive = http.kReqShouldKeepAlive;

const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ProcessNextTick: (callback: (...args: any[]) => void, ...args: unknown[]) => void = process.nextTick;
const constructReadable = internals.constructReadable!;
const resumeOnNextTick = internals.resumeOnNextTick!;
const endOnNextTick = internals.endOnNextTick!;
const preallocatedEvents = internals.preallocatedEvents!;
const holdsNoAccessor = internals.holdsNoAccessor!;
const hearsNothingUnderClose = internals.hearsNothingUnderClose!;
const hearsNothingUnderEnd = internals.hearsNothingUnderEnd!;
const hearsNothingUnderReadable = internals.hearsNothingUnderReadable!;
const hearsNothingButErrors = internals.hearsNothingButErrors!;
const isPlainReadableState = internals.isPlainReadableState!;
const finishReadOfNothing = internals.finishReadOfNothing!;
const finishResume = internals.finishResume!;
const readMoreLater = internals.readMoreLater!;
const readMoreOnNextTick = internals.readMoreOnNextTick!;
const emitReadableNow = internals.emitReadableNow!;
const finishEnd = internals.finishEnd!;
const emitsToListeners = internals.emitsToListeners!;
const emitData = internals.emitData!;
const { read, push, resume, removeAllListeners } = internals.readableMethods!;
const { destroy, closeAfterThrow } = internals.destroyMethods!;
const {
  emit,
  storeEmitWithRejectionCapture,
  listenerCount,
  removeAllListeners: eventEmitterRemoveAllListeners,
} = shared.originals.eventEmitter!;
const ReadablePrototype: object = Readable.prototype;
// A call that the other text does not make while it loads goes to the function under its private name: a test may have replaced
// the one under the public name, and sees every call of it.
const StreamPrototype = Object.$getPrototypeOf(Readable.prototype) as { removeAllListeners: unknown };
function PlainStream() {}
$toClass(PlainStream, "PlainStream", Stream);
const plainStream: any = new PlainStream();

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
const kMultiAwaitDrain = 1 << 17;
const kReadingMore = 1 << 18;
const kDataEmitted = 1 << 19;
const kDefaultUTF8Encoding = 1 << 20;
const kDecoder = 1 << 21;
const kEncoding = 1 << 22;
const kHasFlowing = 1 << 23;
const kFlowing = 1 << 24;
const kHasPaused = 1 << 25;
const kPaused = 1 << 26;
const kDataListening = 1 << 27;

const kFlagsUntouched = kAutoDestroy | kEmitClose | kConstructed | kSync | kReadingMore | kDefaultUTF8Encoding;
const kFlagsResumed = kFlagsUntouched | kHasFlowing | kFlowing | kHasPaused | kResumeScheduled;
// What resume() has stored where it reads process.nextTick.
const kFlagsResuming = kFlagsResumed & ~kHasPaused;
const kFlagsReading = (kFlagsResumed | kReading | kNeedReadable) & ~(kSync | kReadingMore | kResumeScheduled);
// What read(0) inside resume_() has stored where _read() reads process.nextTick.
const kFlagsInRead = kFlagsReading | kSync | kResumeScheduled;
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
      [kAutoDestroyed]: boolean | undefined;
      [kHeadersDistinct]?: Dictionary<string[]>;
      [kHeadersCount]: number;
      [kRawHeaders]: string[] | null;
      [kTrailers]: IncomingHttpHeaders | null;
      [kTrailersDistinct]?: Dictionary<string[]>;
      [kTrailersCount]: number;
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
  const handle = this[kHandle] as $Node.NodeHTTPResponse | undefined;
  if (handle && !this.destroyed) handle.resume();
}

// Compiled ahead of time, a store that names the property makes room for it in every request, though an accessor above takes what is stored.
function storeUnderName(message: $Node.IncomingMessage, name: string, value: unknown) {
  (message as any)[name] = value;
}

function IncomingMessage(
  this: $Node.IncomingMessage,
  socket?: $Node.HttpSocket | null | typeof kMadeOverHandle,
  nativeUrl: string | undefined = undefined,
  nativeMethod: string | undefined = undefined,
  _nativeHeaders: undefined = undefined,
  _nativeRawHeaders: undefined = undefined,
  nativeHandle: $Node.NodeHTTPResponse | undefined = undefined,
  nativeHasBody: boolean | undefined = undefined,
  nativeSocket: $Node.HttpServerSocket | undefined = undefined,
  nativeHighWaterMark: number | undefined = undefined,
) {
  const isFromNativeServer = socket === kMadeOverHandle;
  const isUnreadFromNativeServer =
    isFromNativeServer &&
    nativeHighWaterMark !== undefined &&
    IS_COMPILED_AHEAD_OF_TIME &&
    $findsDeclaredMember(Object.prototype, "__proto__") &&
    $findsDeclaredMember(Number, "isInteger") &&
    $findsDeclaredMember(Math, "floor") &&
    $isPlainHeirOf(this, IncomingMessage) &&
    $findsNoMember(this, "_construct") &&
    this._events === undefined;
  if (isUnreadFromNativeServer) {
    // The stores of below for this one case, in their order, with nothing between them: behind each choice and each call a compiler ahead of time asks anew whether the object is still as it was made.
    const rawTrailers: string[] = [];
    const events = preallocatedEvents();
    const state = createUnreadByteState(nativeHighWaterMark);
    const hasNoBody = !nativeHasBody;
    this[abortedSymbol] = false;
    this[eofInProgress] = false;
    this._consuming = false;
    this._dumped = false;
    this.complete = false;
    this._closed = false;
    this[kHeaders] = null;
    this[kReqShouldKeepAlive] = true;
    this[kRawHeaders] = null;
    this[kHeaderSource] = nativeHandle;
    this[kHeadersCount] = 0;
    this[kTrailers] = null;
    this[kTrailersCount] = 0;
    this.rawTrailers = rawTrailers;
    this[kAbortController] = null;
    this.url = nativeUrl!;
    this.method = nativeMethod!;
    this[kHandle] = nativeHandle;
    this[noBodySymbol] = hasNoBody;
    this.socket = nativeSocket;
    this.client = nativeSocket;
    this.upgrade = null;
    this._events = events as unknown as $Node.Events;
    this._readableState = state;
    this[kShapeMode] = true;
    this._maxListeners ??= undefined;
    if ((this[kCapture] = EventEmitterPrototype[kCapture])) {
      ("unlikely");
      storeEmitWithRejectionCapture(this);
    }
    return;
  }
  this[abortedSymbol] = false;
  this[eofInProgress] = false;
  this._consuming = false;
  this._dumped = false;
  this.complete = false;
  this._closed = false;
  this[kHeaders] = null;
  // The dispatcher that hands over a high-water mark stores no answer of its own.
  this[kReqShouldKeepAlive] = isFromNativeServer && nativeHighWaterMark !== undefined ? true : undefined;
  this[kRawHeaders] = null;
  this[kHeaderSource] = isFromNativeServer ? nativeHandle : undefined;
  this[kHeadersCount] = 0;
  this[kTrailers] = null;
  this[kTrailersCount] = 0;
  this.rawTrailers = [];
  this[kAbortController] = null;

  if (isFromNativeServer) {
    this.url = nativeUrl!;
    this.method = nativeMethod!;
    this[kHandle] = nativeHandle;
    this[noBodySymbol] = !nativeHasBody;
    this.socket = nativeSocket;
    this.client = nativeSocket;
    this.upgrade = null;
    // A Readable looks on its options for names that they do not hold.
    if (IS_COMPILED_AHEAD_OF_TIME && $isObjectPrototypeWithoutAddedNames() && $isPlainHeirOf(this, IncomingMessage)) {
      constructReadable(this, nativeSocket ? nativeSocket.readableHighWaterMark : undefined);
    } else Readable.$call(this, nativeSocket ? { highWaterMark: nativeSocket.readableHighWaterMark } : undefined);
    addFlags(this._readableState, kReadingMore);
    return;
  }

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
  storeUnderName(this, "rawHeaders", []);
  this.joinDuplicateHeaders = false;
  this.upgrade = null;
  this.url = "";
  this.method = null;
  this.statusCode = null;
  this.statusMessage = null;
  this.client = socket;
  this[noBodySymbol] = false;
  this._readableState.readingMore = true;
}
$toClass(IncomingMessage, "IncomingMessage", Readable);

function isPlainRequest(stream: $Node.AnyStream | ReadableStream | WritableStream): stream is $Node.AnyStream {
  return (
    $isPlainInstanceOf(stream, IncomingMessage) &&
    $findsDeclaredMember(stream, "pipe", IncomingMessage) &&
    $findsDeclaredMember(stream, "on", IncomingMessage) &&
    $findsNoMember(stream, "_writableState") &&
    $findsNoMember(stream, "write") &&
    isPlainReadableState((stream as $Node.AnyStream)._readableState)
  );
}
internals.isPlainRequest = isPlainRequest;
Object.$defineProperty(IncomingMessage, "length", { __proto__: null, value: 1, configurable: true });
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

// Whether a lookup of `name` on a message finds `own`, without a read: an accessor of the program's, on the message or above it, is not asked, and no Proxy is met.
function findsWithoutAsking(message: object, name: string, own: unknown): boolean {
  for (let level: object | null = message; level !== null; level = ObjectGetPrototypeOf(level)) {
    if ($isProxyObject(level)) return false;
    const found = ObjectGetOwnPropertyDescriptor(level, name);
    if (found !== undefined) return ObjectHasOwn(found, "value") && found.value === own;
  }
  return false;
}

// Whether a read of `message.rawHeaders` reaches the accessor above, which is not configurable.
function readsRawHeadersThroughAccessor(message: $Node.IncomingMessage): boolean {
  if (IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(message, "rawHeaders", IncomingMessage)) return true;
  if (ObjectHasOwn(message, "rawHeaders")) return false;
  const parent: object | null = ObjectGetPrototypeOf(message);
  if (parent === IncomingMessagePrototype) return true;
  return parent !== null && ObjectPrototypeLookupGetter.$call(parent, "rawHeaders") === getRawHeaders;
}

// Whether a read of `message.readableEnded` reaches the accessor of Readable.prototype, which is not configurable.
function readsReadableEndedThroughAccessor(message: $Node.IncomingMessage): boolean {
  if (IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(message, "readableEnded", IncomingMessage)) {
    return true;
  }
  if (ObjectHasOwn(message, "readableEnded")) return false;
  let level: object | null = ObjectGetPrototypeOf(message);
  if (level === IncomingMessagePrototype) {
    if (ObjectHasOwn(IncomingMessagePrototype, "readableEnded")) return false;
    level = ObjectGetPrototypeOf(IncomingMessagePrototype);
  }
  while (level !== ReadablePrototype) {
    if (level === null || ObjectHasOwn(level, "readableEnded")) return false;
    level = ObjectGetPrototypeOf(level);
  }
  return true;
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

function resumeIfReadable(socket: $Node.HttpSocket) {
  if (socket.readable) socket.resume();
}

function resumeReadableConnection(req: $Node.IncomingMessage, socket: $Node.HttpSocket) {
  if (req.upgrade || socket[kHandoffResponse] !== undefined) {
    ("unlikely");
    // Upgrade request with a body (Node 26 semantics): reading the request must not flip the raw socket into flowing mode - tunnel bytes pushed to the socket before the 'upgrade' listener attaches its own 'data' handler would be discarded by a flowing stream with no readers.
    onIncomingMessageResumeNodeHTTPResponse.$call(req);
  } else if (!socket._paused) {
    if (socket.$resumeUnlessFlowing !== undefined) http.requestRoad.resumeUnlessFlowing!(socket, true);
    else {
      ("unlikely");
      if (IS_COMPILED_AHEAD_OF_TIME) $callNoInline(resumeIfReadable, undefined, socket);
      else resumeIfReadable(socket);
    }
  }
}

const incomingMessageRead = function _read(this: $Node.IncomingMessage, _n: number) {
  if (!this._consuming) {
    const state = this._readableState;
    // The accessor of the class clears a bit. Any other state, and any other thing under the name, is stored into by name.
    if (IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state) && $findsDeclaredMember(state, "readingMore")) {
      state[kState] &= ~kReadingMore;
    } else {
      ("unlikely");
      (state as $Node.ReadableState).readingMore = false;
    }
    this._consuming = true;
  }

  const handle = this[kHandle] as $Node.NodeHTTPResponse | undefined;
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

  const handle = this[kHandle] as $Node.NodeHTTPResponse | undefined;
  if (handle) {
    // Native server path. The stream destroyer (internal/streams/destroy.ts)
    // assigns `req.socket = null` before calling destroy() to signal that the
    // connection must outlive the request so the response can still reply
    // (node's _destroy null-socket check).
    this[kHandle] = undefined;
    handle.onabort = handle.ondata = undefined;
    let connection: $Node.IncomingMessage["socket"];
    if (!handle.finished && shouldEmitAborted && (connection = this.socket)) {
      http.responseRoad.flushSocketHeldChunk?.(connection);
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
      storeUnderName(this, "rawHeaders", headers);
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

// A table of listeners as it was born holds its names as data and no other name: a look into it runs no code of the program. Any other table is not looked into: whoever asks goes the long way, where plain's text looks. The looks stand beside the table's maker.
function isCloseUnheard(req: $Node.IncomingMessage): boolean {
  if (
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "emit", IncomingMessage)) &&
    !findsWithoutAsking(req, "emit", emit)
  )
    return false;
  return IS_COMPILED_AHEAD_OF_TIME && hearsNothingUnderClose(req._events);
}

function isEndUnheard(req: $Node.IncomingMessage): boolean {
  if (
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "emit", IncomingMessage)) &&
    !findsWithoutAsking(req, "emit", emit)
  )
    return false;
  return IS_COMPILED_AHEAD_OF_TIME && hearsNothingUnderEnd(req._events);
}

function isReadableUnheard(req: $Node.IncomingMessage): boolean {
  if (
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "emit", IncomingMessage)) &&
    !findsWithoutAsking(req, "emit", emit)
  )
    return false;
  return IS_COMPILED_AHEAD_OF_TIME && hearsNothingUnderReadable(req._events);
}

// `resume` is no name of the born table: where it is absent it is looked for on Object.prototype.
function isResumeUnheard(req: $Node.IncomingMessage): boolean {
  if (
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "emit", IncomingMessage)) &&
    !findsWithoutAsking(req, "emit", emit)
  )
    return false;
  const events = req._events;
  return (
    IS_COMPILED_AHEAD_OF_TIME &&
    holdsNoAccessor(events) &&
    $isObjectPrototypeWithoutAddedNames() &&
    events!.resume === undefined
  );
}

// The end of an untouched request looks, in plain's text, under removeListener and data (removeAllListeners("data")), resume, readable, end and close. A store into the table does not move the count.
function isEndOfUntouchedRequestUnheard(req: $Node.IncomingMessage): boolean {
  return IS_COMPILED_AHEAD_OF_TIME && hearsNothingButErrors(req._events) && $isObjectPrototypeWithoutAddedNames();
}

function endsUnwatched(req: $Node.IncomingMessage) {
  let state: $Node.ReadableState;
  try {
    if (
      !(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage)) ||
      !req[noBodySymbol] ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "resume", IncomingMessage)) &&
        !findsWithoutAsking(req, "resume", resume))
    ) {
      return false;
    }
    state = req._readableState;
    if (!advanceFlags(state, kFlagsUntouched, kFlagsResuming)) return false;
  } catch {
    return false;
  }
  // resume() reads process.nextTick here, behind those stores: what an accessor there throws comes out of _dump() as it comes out of resume().
  if (!ticksAreUnseen() || state[kState] !== kFlagsResuming) {
    ("unlikely");
    // A process.nextTick of the program's own is handed the callback of the long road, and an accessor may have touched the request: the rest of resume().
    queueTick2(resumeOnNextTick, req, state);
    state[kState] = (state[kState] | kHasPaused) & ~kPaused;
    return true;
  }
  state[kState] = kFlagsResumed | 0;
  queueTick2(resumeUnwatched, req, state);
  return true;
}

function resumesUnwatched(req: $Node.IncomingMessage, state: $Node.ReadableState): boolean {
  try {
    return (
      IS_COMPILED_AHEAD_OF_TIME &&
      $isPlainHeirOf(req, IncomingMessage) &&
      !!req[kHandle] &&
      !req._consuming &&
      !req[eofInProgress] &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "read", IncomingMessage)) ||
        findsWithoutAsking(req, "read", read)) &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_read", IncomingMessage)) ||
        findsWithoutAsking(req, "_read", incomingMessageRead)) &&
      req._readableState === state &&
      $findsDeclaredMember(state, "readingMore") &&
      advanceFlags(state, kFlagsResumed, kFlagsInRead)
    );
  } catch {
    return false;
  }
}

function resumeUnwatched(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  if (!resumesUnwatched(req, state)) {
    ("unlikely");
    return resumeOnNextTick(req, state);
  }
  let unseen = false;
  try {
    req._consuming = true;
    resumeConnection(req);
    req[eofInProgress] = true;
    // The socket's resume() may be the program's: the look and the word stand behind it.
    unseen = isResumeUnheard(req) && ticksAreUnseen() && state[kState] === kFlagsInRead;
    if (!unseen) {
      ("unlikely");
      queueTick1(emitEOFIncomingMessageOuter, req);
    }
  } catch (err) {
    unseen = false;
    const stream: $Node.Readable = req;
    errorOrDestroy(stream, err as Error);
  }
  if (!unseen) {
    ("unlikely");
    finishReadOfNothing(state);
    return finishResume(req, state);
  }
  state[kState] = kFlagsReading | 0;
  if (ring.read === ring.write) endUnwatched(req);
  else enqueueTick1(endUnwatched, req);
}

function endsItsBodyUnwatched(req: $Node.IncomingMessage): boolean {
  try {
    return (
      IS_COMPILED_AHEAD_OF_TIME &&
      $isPlainHeirOf(req, IncomingMessage) &&
      isReadableUnheard(req) &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "push", IncomingMessage)) ||
        findsWithoutAsking(req, "push", push)) &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "read", IncomingMessage)) ||
        findsWithoutAsking(req, "read", read)) &&
      advanceFlags(req._readableState, kFlagsReading, kFlagsEnded)
    );
  } catch {
    return false;
  }
}

function endUnwatched(req: $Node.IncomingMessage) {
  if (!endsItsBodyUnwatched(req)) {
    ("unlikely");
    return emitEOFIncomingMessageOuter(req);
  }
  const state = req._readableState;
  req.complete = true;
  let held: $Node.HTTPParser | $Node.HttpServerParserShim | undefined;
  try {
    const parser = req.socket?.parser;
    held = parser != null && parser.incoming === req ? parser : undefined;
  } catch (error) {
    queueTick3(destroyUnwatched, req, state, undefined);
    throw error;
  }
  if (ring.read === ring.write && ticksAreUnseen()) destroyUnwatched(req, state, held);
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

function handleToDestroyUnwatched(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  try {
    if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage)) || !isEndUnheard(req)) return undefined;
    const handle = req[kHandle] as $Node.NodeHTTPResponse | undefined;
    let side = 0;
    if (
      !handle ||
      !req.complete ||
      (side = writableSideOf(req)) === 2 ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "destroy", IncomingMessage)) &&
        !findsWithoutAsking(req, "destroy", destroy)) ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_destroy", IncomingMessage)) &&
        !findsWithoutAsking(req, "_destroy", incomingMessageDestroy)) ||
      req._readableState !== state ||
      // destroy() reads it once more.
      (side === 1 && !!req._writableState) ||
      !readsItsSocketUnseen(req) ||
      !readsReadableEndedThroughAccessor(req) ||
      !advanceFlags(state, kFlagsEnded, kFlagsDestroyed)
    ) {
      return undefined;
    }
    return handle;
  } catch {
    return undefined;
  }
}

function destroyOnNextTick(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  const handle = handleToDestroyUnwatched(req, state);
  if (handle === undefined) {
    ("unlikely");
    return endOnNextTick(state, req);
  }
  req[kAutoDestroyed] = true;
  let unseen: boolean;
  try {
    req[kHandle] = undefined;
    handle.onabort = undefined;
    unseen = ticksAreUnseen();
  } catch (err) {
    return closeAfterThrow(req, state, err);
  }
  if (!unseen) {
    ("unlikely");
    return closeAsDestroyDoes(req, state);
  }
  enqueueTick1(closeUnwatched, req);
}

// _destroy() reads process.nextTick once, behind the mark and its stores, and what that read throws closes the request. A function of the program's own is handed what _destroy() hands it.
function closeAsDestroyDoes(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  let isCalled = false;
  function onDestroy(err?: Error | null) {
    if (isCalled) return;
    isCalled = true;
    closeAfterThrow(req, state, err);
  }
  try {
    emitErrorNextTickIfErrorListenerNT(req, null, onDestroy);
  } catch (err) {
    onDestroy(err as Error);
  }
}

function mayDumpInPlace(req: $Node.IncomingMessage): boolean {
  try {
    return (
      IS_COMPILED_AHEAD_OF_TIME &&
      $isPlainHeirOf(req, IncomingMessage) &&
      req._readableState[kState] === kFlagsUntouched &&
      req[noBodySymbol] &&
      !req._dumped &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_dump", IncomingMessage)) ||
        findsWithoutAsking(req, "_dump", dump)) &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "resume", IncomingMessage)) ||
        findsWithoutAsking(req, "resume", resume)) &&
      ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "removeAllListeners", IncomingMessage)) ||
        findsWithoutAsking(req, "removeAllListeners", removeAllListeners)) &&
      readsReadableEndedThroughAccessor(req)
    );
  } catch {
    return false;
  }
}

// A listener for `removeListener` runs in the midst. Where it has touched the request, the request is resumed as _dump() resumes it, and no half of the dump is left to do.
function beginDump(req: $Node.IncomingMessage): boolean {
  req._dumped = true;
  req.removeAllListeners("data");
  if (!advanceFlags(req._readableState, kFlagsUntouched, kFlagsResumed)) {
    ("unlikely");
    req.resume();
    return false;
  }
  return true;
}

// What the tick of _destroy() does, and behind it the callback that destroy() hands to _destroy().
function closeWatched(self: $Node.IncomingMessage) {
  void (self.listenerCount("error") == 0);
  const r = self._readableState;
  const w = self._writableState;
  if (w) w[kState] |= kClosed;
  if (r) r[kState] |= kClosed;
  ProcessNextTick(emitCloseWatched, self);
}

// As emitCloseNT() of the streams.
function emitCloseWatched(self: $Node.IncomingMessage) {
  const r = self._readableState;
  const w = self._writableState;
  if (w) w[kState] |= kCloseEmitted;
  if (r) r[kState] |= kCloseEmitted;
  if ((w && (w[kState] & kEmitClose) !== 0) || (r && (r[kState] & kEmitClose) !== 0)) {
    if (!emitsToListeners(self, "close")) self.emit("close");
  }
}

// Asked in the tick itself. The questions run no code of the program, and none runs between them and the stores.
function closeUnwatched(self: $Node.IncomingMessage) {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    $isPlainHeirOf(self, IncomingMessage) &&
    $findsNoMember(self, "_writableState") &&
    $findsDeclaredMember(self, "listenerCount", IncomingMessage) &&
    holdsNoAccessor(self._events)
  )) {
    ("unlikely");
    return closeWatched(self);
  }
  const state = self._readableState;
  if (!(IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state))) {
    ("unlikely");
    return closeWatched(self);
  }
  state[kState] |= kClosed;
  if (ProcessNextTick !== originalNextTick) {
    ("unlikely");
    ProcessNextTick(emitCloseUnwatched, self);
  } else if (ring.read === ring.write && ticksAreUnhooked()) emitCloseAsked(self, state);
  else enqueueTick1(emitCloseUnwatched, self);
}

function emitCloseUnwatched(req: $Node.IncomingMessage) {
  if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage) && $findsNoMember(req, "_writableState"))) {
    ("unlikely");
    return emitCloseWatched(req);
  }
  const state = req._readableState;
  if (!(IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state))) {
    ("unlikely");
    return emitCloseWatched(req);
  }
  emitCloseAsked(req, state);
}

function emitCloseAsked(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  const flags = state[kState] | kCloseEmitted;
  state[kState] = flags;
  if ((flags & kEmitClose) !== 0 && !emitsToListeners(req, "close")) req.emit("close");
}

function takeCloseTick(req: $Node.IncomingMessage): boolean {
  const tick = ring.read!;
  if (
    tick === ring.write ||
    tick.next !== ring.write ||
    tick.callback !== closeUnwatched ||
    tick.first !== req ||
    ProcessNextTick !== originalNextTick ||
    !ticksAreUnhooked() ||
    !(
      IS_COMPILED_AHEAD_OF_TIME &&
      $isPlainHeirOf(req, IncomingMessage) &&
      $findsNoMember(req, "_writableState") &&
      $findsDeclaredMember(req, "listenerCount", IncomingMessage)
    )
  ) {
    return false;
  }
  const state = req._readableState;
  if (!(IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state))) return false;
  if (!isCloseUnheard(req)) return false;
  state[kState] |= kClosed | kCloseEmitted;
  ring.read = tick.next;
  tick.callback = undefined;
  tick.frame = undefined;
  tick.first = undefined;
  return true;
}

internals.takeRequestCloseTick = takeCloseTick;

function resumeRequestBody(stream: $Node.Readable, state: $Node.ReadableState): boolean {
  const flags = state[kState];
  const req: $Node.IncomingMessage = stream as any;
  let handle: $Node.IncomingMessage[typeof kHandle];
  try {
    if (
      (flags & ~kDecoding) !== kBodyResumed ||
      !(IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state)) ||
      !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(state, "readingMore")) ||
      state.length !== 0 ||
      !(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage)) ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_read", IncomingMessage)) &&
        !findsWithoutAsking(req, "_read", incomingMessageRead))
    )
      return false;
    handle = req[kHandle] as $Node.NodeHTTPResponse | undefined;
    if (
      !handle ||
      req._consuming ||
      req[eofInProgress] ||
      req[noBodySymbol] ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "read", IncomingMessage)) &&
        !findsWithoutAsking(req, "read", read)) ||
      req._readableState !== state
    ) {
      ("unlikely");
      return false;
    }
  } catch {
    return false;
  }
  const asked = (flags & kDecoding) | kBodyAsked;
  state[kState] = asked;
  try {
    req._consuming = true;
    resumeConnection(req);
    const bodyReadState = handle.hasBody;
    if ((bodyReadState & NodeHTTPBodyReadState.done) !== 0 || bodyReadState === NodeHTTPBodyReadState.none) {
      ("unlikely");
      emitEOFIncomingMessage(req);
    }
  } catch (err) {
    errorOrDestroy(stream, err as Error);
  }
  if (isResumeUnheard(req) && state[kState] === asked && state.length === 0) {
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
  return takeBodyData(this, chunk, isLast, aborted);
}

internals.onRequestBodyData = onBodyData;

// `stream` and `chunk` as in addChunk(): a TypeError about a replaced emit() quotes the call.
function takeBodyData(stream: $Node.IncomingMessage, bytes: Buffer | undefined, isLast: boolean, aborted: number) {
  // Behind the yes no read off the request runs code of the program: an accessor laid on one of its fields lies outside its slot.
  if (
    aborted !== NodeHTTPResponseAbortEvent.none ||
    !(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(stream, IncomingMessage))
  ) {
    ("unlikely");
    return onDataIncomingMessage.$call(stream, bytes, isLast, aborted);
  }
  const state = stream._readableState;
  if (!(IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state))) {
    ("unlikely");
    return onDataIncomingMessage.$call(stream, bytes, isLast, aborted);
  }
  const flags = state[kState];
  const word = flags & ~kDecoding;
  // Only the native server hands over a body this way.
  const socket: $Node.HttpServerSocket | null | undefined = stream.socket as any;
  if (
    !isLast ||
    bytes === undefined ||
    (word !== kBodyReading &&
      (word !== kBodyAwaited || bytes.length * ((flags & kDecoder) !== 0 ? 2 : 1) >= state.highWaterMark)) ||
    state.length !== 0 ||
    stream._dumped ||
    stream.upgrade ||
    stream[eofInProgress] ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(stream, "push", IncomingMessage)) &&
      !findsWithoutAsking(stream, "push", push)) ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(stream, "read", IncomingMessage)) &&
      !findsWithoutAsking(stream, "read", read)) ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(stream, "_read", IncomingMessage)) &&
      !findsWithoutAsking(stream, "_read", incomingMessageRead)) ||
    (socket != null && !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(socket, "_unrefTimer"))) ||
    !ticksAreUnseen()
  ) {
    ("unlikely");
    return onDataIncomingMessage.$call(stream, bytes, isLast, aborted);
  }

  socket?._unrefTimer();

  const decoding = flags & ~kReading;
  state[kState] = decoding;
  const chunk = (flags & kDecoder) !== 0 ? state[kDecoderValue]!.write(bytes) : bytes;
  const given = (flags & kDecoding) | kBodyGiven;
  const length = chunk.length as number;
  // The decoder's write() may be the program's.
  const isAsTested = (flags & kDecoder) === 0 || (state[kState] === decoding && state.length === 0);
  if (!isAsTested) {
    ("unlikely");
    if (length !== 0) addDecodedChunk(stream, state, chunk, length);
  } else if (length !== 0 && word === kBodyReading) {
    state.awaitDrainWriters = null;
    state[kState] = given;
    emitData(stream, chunk);
  }
  if (isAsTested && length !== 0 && word === kBodyAwaited) {
    state.length = length;
    state.buffer.push(chunk);
    state[kState] = (flags & kDecoding) | kBodyBuffered;
    queueTick1(emitReadableNow, stream);
    markEndInProgress(stream, state);
    queueTick2(finishBufferedBody, stream, state);
  } else if (isAsTested && state[kState] === given && state.length === 0) {
    state[kState] = given | kReadingMore;
    markEndInProgress(stream, state);
    queueTick2(finishBody, stream, state);
  } else {
    ("unlikely");
    readMoreLater(stream, state);
    if ((state[kState] & kEnded) !== 0 || (state.length >= state.highWaterMark && state.length !== 0)) {
      const finSent = socket?.[kHandle]?.finSent === true;
      // Nothing reads this body and a pause would hide the peer's FIN: uWS drops the later reads, so that FIN closes the connection.
      if (finSent && !stream._consuming) socket![kHandle]!.stopParsing();
      else if (socket && (finSent || !socket.writableEnded)) {
        socket.pause();
        stream[kHandle]?.pause();
      }
    }
    emitEOFIncomingMessage(stream);
  }
  if (!stream.upgrade && socket && !socket._paused && socket.readable) {
    if (socket.$resumeUnlessFlowing !== undefined) http.requestRoad.resumeUnlessFlowing!(socket, false);
    else {
      ("unlikely");
      socket.resume();
    }
  }
}

// As readable's addChunk() adds a chunk at the end, less its look for more, which the caller takes.
function addDecodedChunk(
  stream: $Node.IncomingMessage,
  state: $Node.ReadableState,
  chunk: string | Buffer,
  length: number,
) {
  if ((state[kState] & (kFlowing | kSync | kDataListening)) === (kFlowing | kDataListening) && state.length === 0) {
    if ((state[kState] & kMultiAwaitDrain) !== 0) (state.awaitDrainWriters as Set<$Node.AnyStream>).clear();
    else state.awaitDrainWriters = null;
    state[kState] |= kDataEmitted;
    emitData(stream, chunk);
    return;
  }
  state.length += length;
  state.buffer.push(chunk);
  if ((state[kState] & kNeedReadable) === 0) return;
  state[kState] &= ~kNeedReadable;
  if ((state[kState] & kEmittedReadable) === 0) {
    state[kState] |= kEmittedReadable;
    queueTick1(emitReadableNow, stream);
  }
}

function markEndInProgress(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  try {
    req[eofInProgress] = true;
  } catch (error) {
    queueTick2(readMoreOnNextTick, req, state);
    throw error;
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

// A tick runs in a later turn than the one that queued it: what was asked there is asked again.
function finishBody(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage) && isPlainReadableState(state))) {
    ("unlikely");
    return readMoreThenEnd(req, state);
  }
  const flags = state[kState];
  if (
    req._readableState !== state ||
    (flags & ~kDecoding) !== (kBodyGiven | kReadingMore) ||
    state.length !== 0 ||
    !req[kHandle] ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "read", IncomingMessage)) &&
      !findsWithoutAsking(req, "read", read)) ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_read", IncomingMessage)) &&
      !findsWithoutAsking(req, "_read", incomingMessageRead))
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
  if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage) && isPlainReadableState(state))) {
    ("unlikely");
    return readMoreThenEnd(req, state);
  }
  const flags = state[kState];
  const length = state.length;
  if (
    req._readableState !== state ||
    (flags & ~kDecoding) !== kBodyAnnounced ||
    length === 0 ||
    length >= state.highWaterMark ||
    !req[kHandle] ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "read", IncomingMessage)) &&
      !findsWithoutAsking(req, "read", read)) ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_read", IncomingMessage)) &&
      !findsWithoutAsking(req, "_read", incomingMessageRead))
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
  if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage) && isPlainReadableState(state))) {
    ("unlikely");
    return emitEOFIncomingMessageOuter(req);
  }
  const handle = req[kHandle] as $Node.NodeHTTPResponse | undefined;
  if (
    handle === undefined ||
    req._readableState !== state ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "push", IncomingMessage)) &&
      !findsWithoutAsking(req, "push", push)) ||
    (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "read", IncomingMessage)) &&
      !findsWithoutAsking(req, "read", read))
  ) {
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
  let flags = state[kState];
  let asked = flags;
  if ((flags & kDecoder) !== 0) {
    // The decoder's end() may be the program's: it finds the request no longer reading, as behind push(null).
    asked = flags & ~kReading;
    state[kState] = asked;
    const rest = state[kDecoderValue]!.end();
    if (rest?.length) {
      ("unlikely");
      state.buffer.push(rest);
      state.length += rest.length as number;
    }
  }
  flags = state[kState];
  let isUnheard = false;
  if (flags === asked && state.length === 0 && (flags & kFlowing) !== 0) {
    isUnheard = isReadableUnheard(req);
  }
  if (!isUnheard) {
    state[kState] = (flags & ~(kReading | kNeedReadable)) | kEnded | kEmittedReadable;
    emitReadableNow(req);
    return releaseParserOnNextTick(req);
  }
  state[kState] = (flags & kDecoding) | kBodyEnded;
  if (ring.read === ring.write && ticksAreUnseen()) {
    try {
      releaseParserOnNextTick(req);
    } catch (error) {
      queueTick2(endOnNextTick, state, req);
      throw error;
    }
    emitBodyEnd(req, state);
  } else {
    queueTick2(endOnNextTick, state, req);
    releaseParserOnNextTick(req);
  }
}

function emitBodyEnd(req: $Node.IncomingMessage, state: $Node.ReadableState) {
  state[kState] |= kEndEmitted;
  if (!emitsToListeners(req, "end")) req.emit("end");
  return finishEnd(state, req);
}

function destroyEndedRequest(state: $Node.ReadableState, stream: $Node.Readable): boolean {
  const req: $Node.IncomingMessage = stream as any;
  let handle: $Node.IncomingMessage[typeof kHandle];
  let side = 0;
  try {
    if (
      (state[kState] & kDestroysItselfMask) !== kDestroysItself ||
      !(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage)) ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_destroy", IncomingMessage)) &&
        !findsWithoutAsking(req, "_destroy", incomingMessageDestroy))
    )
      return false;
    handle = req[kHandle] as $Node.NodeHTTPResponse | undefined;
    if (
      !handle ||
      !req.complete ||
      (side = writableSideOf(req)) === 2 ||
      (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "destroy", IncomingMessage)) &&
        !findsWithoutAsking(req, "destroy", destroy)) ||
      req._readableState !== state ||
      // destroy() reads it once more.
      (side === 1 && !!req._writableState) ||
      !readsReadableEndedThroughAccessor(req) ||
      !readsItsSocketUnseen(req)
    ) {
      ("unlikely");
      return false;
    }
    req[kAutoDestroyed] = true;
  } catch {
    return false;
  }
  state[kState] |= kDestroyed;
  let unseen: boolean;
  try {
    req[kHandle] = undefined;
    handle.onabort = handle.ondata = undefined;
    unseen = ticksAreUnseen();
  } catch (err) {
    closeAfterThrow(req, state, err);
    return true;
  }
  if (!unseen) {
    ("unlikely");
    closeAsDestroyDoes(req, state);
    return true;
  }
  const tick = ring.read!;
  if (
    tick !== ring.write &&
    tick.next === ring.write &&
    tick.callback === clearServerParserIncoming &&
    tick.second === req &&
    tick.frame === $getInternalField(asyncContext, 0)
  ) {
    tick.callback = releaseParserThenClose;
  } else {
    enqueueTick1(closeUnwatched, req);
  }
  return true;
}

function releaseParserThenClose(parser: $Node.HTTPParser | $Node.HttpServerParserShim, req: $Node.IncomingMessage) {
  clearServerParserIncoming(parser, req);
  closeUnwatched(req);
}

internals.destroyEndedRequest = destroyEndedRequest;

// `writable` and `_writableState` are names that a request lacks. What the request itself holds under one of them is not asked here: the road that reads it asks, once.
// 0: a lookup of neither name finds anything. 1: each was read once and is falsy. 2: the request may have a writable side.
function writableSideOf(req: $Node.IncomingMessage): number {
  if (
    IS_COMPILED_AHEAD_OF_TIME &&
    $isPlainHeirOf(req, IncomingMessage) &&
    $findsNoMember(req, "writable") &&
    $findsNoMember(req, "_writableState")
  ) {
    return 0;
  }
  return ObjectHasOwn(req, "writable") || ObjectHasOwn(req, "_writableState") || !!req.writable || !!req._writableState
    ? 2
    : 1;
}

function mayHaveWritableSide(req: $Node.IncomingMessage): boolean {
  return writableSideOf(req) === 2;
}

function hasNoListenerAndNoWritableSide(req: $Node.IncomingMessage): boolean {
  return (!ObjectHasOwn(req, "_eventsCount") || req._eventsCount === 0) && !mayHaveWritableSide(req);
}

function beginUnseenDump(req: $Node.IncomingMessage): void {
  req._dumped = true;
  req[kShapeMode] = false;
  req._readableState[kState] = kFlagsResumed | 0;
}

function staysUnseen(req: $Node.IncomingMessage): boolean {
  try {
    if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage))) return false;
    if (!isEndOfUntouchedRequestUnheard(req)) return false;
    const state = req._readableState;
    return (
      IS_COMPILED_AHEAD_OF_TIME &&
      isPlainReadableState(state) &&
      $findsDeclaredMember(state, "readingMore") &&
      state[kState] === kFlagsResumed &&
      state.length === 0 &&
      req[noBodySymbol] &&
      req._dumped &&
      !req._consuming &&
      !req[eofInProgress] &&
      readsItsSocketUnseen(req) &&
      keepsItsMethods(req)
    );
  } catch {
    return false;
  }
}

function continueDump(req: $Node.IncomingMessage, state: $Node.ReadableState): void {
  resumeUnwatched(req, state);
}

function queueDump(req: $Node.IncomingMessage, state: $Node.ReadableState): void {
  queueTick2(resumeUnwatched, req, state);
}

// One statement a question: where two arms meet, a compiler ahead of time forgets what it has asked of the request, and `&&` is such a place.
function endsUnseen(req: $Node.IncomingMessage): boolean {
  try {
    if (!(IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage))) return false;
    if (!isEndOfUntouchedRequestUnheard(req)) return false;
    const state = req._readableState;
    if (!(IS_COMPILED_AHEAD_OF_TIME && isPlainReadableState(state))) return false;
    if (!(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(state, "readingMore"))) return false;
    if (state[kState] !== kFlagsUntouched) return false;
    if (state.length !== 0) return false;
    if (!req[noBodySymbol]) return false;
    if (req._dumped) return false;
    if (req._consuming) return false;
    if (req[eofInProgress]) return false;
    return keepsItsMethods(req);
  } catch {
    return false;
  }
}

// Readable.prototype.removeAllListeners() goes on to what a lookup from Stream.prototype finds.
function streamsRemoveAllListenersAsEmittersDo(): boolean {
  return (
    (IS_COMPILED_AHEAD_OF_TIME &&
      $isPlainInstanceOf(plainStream, PlainStream) &&
      $findsDeclaredMember(plainStream, "removeAllListeners")) ||
    findsWithoutAsking(StreamPrototype, "removeAllListeners", eventEmitterRemoveAllListeners)
  );
}

function keepsItsMethods(req: $Node.IncomingMessage): boolean {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    $findsDeclaredMember(req, "emit", IncomingMessage) &&
    $findsDeclaredMember(req, "_dump", IncomingMessage) &&
    $findsDeclaredMember(req, "removeAllListeners", IncomingMessage) &&
    $findsDeclaredMember(req, "resume", IncomingMessage) &&
    $findsDeclaredMember(req, "read", IncomingMessage) &&
    $findsDeclaredMember(req, "push", IncomingMessage) &&
    $findsDeclaredMember(req, "destroy", IncomingMessage) &&
    $findsDeclaredMember(req, "listenerCount", IncomingMessage) &&
    $findsDeclaredMember(req, "readableEnded", IncomingMessage)
  )) {
    ("unlikely");
    return readsTheMethodsOfItsClass(req);
  }
  if (!streamsRemoveAllListenersAsEmittersDo()) return false;
  // Once a stream has taken `read` or `destroy` from its options, no stream is known to have kept these two.
  if (
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_read", IncomingMessage)) &&
    !findsWithoutAsking(req, "_read", incomingMessageRead)
  )
    return false;
  if (
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(req, "_destroy", IncomingMessage)) &&
    !findsWithoutAsking(req, "_destroy", incomingMessageDestroy)
  )
    return false;
  return hasNoListenerAndNoWritableSide(req);
}

function readsTheMethodsOfItsClass(req: $Node.IncomingMessage): boolean {
  return (
    findsWithoutAsking(req, "emit", emit) &&
    findsWithoutAsking(req, "_dump", dump) &&
    findsWithoutAsking(req, "removeAllListeners", removeAllListeners) &&
    streamsRemoveAllListenersAsEmittersDo() &&
    findsWithoutAsking(req, "resume", resume) &&
    findsWithoutAsking(req, "read", read) &&
    findsWithoutAsking(req, "_read", incomingMessageRead) &&
    findsWithoutAsking(req, "push", push) &&
    findsWithoutAsking(req, "destroy", destroy) &&
    findsWithoutAsking(req, "_destroy", incomingMessageDestroy) &&
    findsWithoutAsking(req, "listenerCount", listenerCount) &&
    readsReadableEndedThroughAccessor(req) &&
    hasNoListenerAndNoWritableSide(req)
  );
}

function readsItsSocketUnseen(req: $Node.IncomingMessage): boolean {
  const socket = req.socket;
  return !socket || http.requestRoad.readsDestroyedUnseen!(socket);
}

function endUnseen(req: $Node.IncomingMessage): void {
  // The one store that a request closed in any way refuses comes first, so that a request is ended whole or not at all.
  req[kAutoDestroyed] = true;
  req._dumped = true;
  req[kShapeMode] = false;
  req._consuming = true;
  req.complete = true;
  req[eofInProgress] = true;
  req[kHandle] = undefined;
  req._readableState[kState] = kFlagsClosed | kCloseEmitted;
}

// Whether a read of a field of the request runs no code of the program.
function readsUnseen(req: $Node.IncomingMessage): boolean {
  return IS_COMPILED_AHEAD_OF_TIME && $isPlainHeirOf(req, IncomingMessage) ? true : false;
}

// Asked here: the question wants the file's own binding of the class.
function chainIsPlain(): boolean {
  return IS_COMPILED_AHEAD_OF_TIME && $isPrototypeChainPlain(IncomingMessage) ? true : false;
}

http.requestRoad.endsUnseen = endsUnseen;
http.requestRoad.endUnseen = endUnseen;
http.requestRoad.beginUnseenDump = beginUnseenDump;
http.requestRoad.staysUnseen = staysUnseen;
http.requestRoad.continueDump = continueDump;
http.requestRoad.queueDump = queueDump;
http.requestRoad.mayDumpInPlace = mayDumpInPlace;
http.requestRoad.beginDump = beginDump;
http.requestRoad.readsUnseen = readsUnseen;
http.requestRoad.chainIsPlain = chainIsPlain;

function onError(self: $Node.IncomingMessage, error: Error | null | undefined, cb: $Node.ErrorCallback) {
  // This is to keep backward compatible behavior.
  // An error is emitted only if there are listeners attached to the event.
  if (self.listenerCount("error") === 0) {
    cb();
  } else {
    cb(error);
  }
}

http.responseRoad.IncomingMessage = IncomingMessage;

export { IncomingMessage, kReqShouldKeepAlive, readStart, readStop };
