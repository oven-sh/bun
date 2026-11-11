// NativeReadable is an implementation of ReadableStream which contains
// a pointer to a native handle. This is used, for example, to make
// child_process' stderr/out streams go through less hoops.
//
// Normally, Readable.fromWeb will wrap the ReadableStream in JavaScript. In
// Bun, `fromWeb` is able to check if the stream is backed by a native handle,
// to which it will take this path.
const Readable = require("internal/streams/readable");
const transferToNativeReadable: (stream: ReadableStream) => void = $newCppFunction(
  "streams/BunStreamConsumers.cpp",
  "jsFunctionTransferToNativeReadableStream",
  1,
);
const { errorOrDestroy } = require("internal/streams/destroy");

const kRefCount = Symbol("refCount");
const kCloseState = Symbol("closeState");
const kConstructed = Symbol("constructed");
const kHighWaterMark = Symbol("highWaterMark");
const kPendingRead = Symbol("pendingRead");
const kHasResized = Symbol("hasResized");
const kRemainingChunk = Symbol("remainingChunk");
const kDeliver = Symbol("deliver");
const kPullView = Symbol("pullView");
const kViewSize = Symbol("viewSize");

const MIN_BUFFER_SIZE = 512;
// What the native reader of a file or a pipe reads at once.
const LARGE_VIEW_SIZE = 256 * 1024;
let dynamicallyAdjustChunkSize = (_?) => (
  (_ = process.env.BUN_DISABLE_DYNAMIC_CHUNK_SIZE !== "1"),
  (dynamicallyAdjustChunkSize = () => _)
);

interface NativeReadable extends $Node.Readable {
  $bunNativePtr: NativePtr | undefined;
  $start?: typeof ensureConstructed;
  ref: typeof ref;
  unref: typeof unref;
  [kRefCount]: number;
  [kCloseState]: [boolean];
  [kConstructed]: boolean;
  [kPendingRead]: boolean;
  [kHighWaterMark]: number;
  [kHasResized]: boolean;
  [kRemainingChunk]: Buffer | undefined;
  // Set for good once the stream has a consumer: see `deliverOf`.
  [kDeliver]: Deliver | undefined;
  // What the pull that waits reads into.
  [kPullView]: Buffer | undefined;
  // The size of a new view, once a read has filled one. 0: the size that Readable asks for.
  [kViewSize]: number;
  debugId: number;
}

// `result` is what pull() returns without it. `failed`: `result` is the error of the read.
type Deliver = (result: any, isClosed: boolean, failed: boolean) => void;

interface NativePtr {
  onClose: () => void;
  onDrain: (chunk: any) => void;
  // With `deliver` nothing is returned: each result comes through it on a later turn of the event loop, and `true` says that one is on its way.
  start: (highWaterMark: number, deliver?: Deliver) => any;
  drain: () => any;
  pull: (view: any, closer: any, deliver?: Deliver) => any;
  updateRef: (ref: boolean) => void;
  // `callback` runs on a later turn of the event loop.
  cancel: (error: any, callback?: () => void) => void;
  setFlowing?: (flowing: boolean) => void;
}

let debugId = 0;

function constructNativeReadable(readableStream: ReadableStream, options: $Node.ReadableOptions): NativeReadable {
  $assert(typeof readableStream === "object" && readableStream instanceof ReadableStream, "Invalid readable stream");
  const bunNativePtr = readableStream.$bunNativePtr;
  // A closed stream with nothing left to read has no native handle, so read() ends it immediately.
  $assert(bunNativePtr === undefined || typeof bunNativePtr === "object", "Invalid native ptr");

  const stream = new Readable(options) as NativeReadable;
  stream._read = read;
  stream._destroy = destroy;

  if (!!$debug) {
    stream.debugId = ++debugId;
  }

  // Define the own property directly: an ordinary put would walk the prototype
  // chain, which user code can graft onto ReadableStream.prototype's accessors.
  $putByIdDirectPrivate(stream, "bunNativePtr", bunNativePtr);
  stream[kRefCount] = 0;
  stream[kConstructed] = false;
  stream[kPendingRead] = false;
  stream[kHasResized] = !dynamicallyAdjustChunkSize();
  stream[kCloseState] = [false];
  stream[kDeliver] = undefined;
  stream[kPullView] = undefined;
  stream[kViewSize] = 0;

  const highWaterMark = options.highWaterMark;
  stream[kHighWaterMark] = typeof highWaterMark === "number" ? highWaterMark : 256 * 1024;

  stream.ref = ref;
  stream.unref = unref;
  if (process.platform === "win32") {
    // Only used by node:tty on Windows
    stream.$start = ensureConstructed;
  }

  // https://github.com/oven-sh/bun/pull/12801
  // https://github.com/oven-sh/bun/issues/9555
  // There may be a ReadableStream.Strong handle to the ReadableStream.
  // We can't update those handles to point to the NativeReadable from JS
  // So we instead mark it as no longer usable, and create a new NativeReadable
  transferToNativeReadable(readableStream);

  $debug(`[${stream.debugId}] constructed!`);

  return stream;
}

function ensureConstructed(this: NativeReadable, cb: null | (() => void)) {
  $debug(`[${this.debugId}] ensureConstructed`);
  if (this[kConstructed]) return;
  this[kConstructed] = true;
  const ptr = this.$bunNativePtr;
  if (!ptr) return;
  $assert(typeof ptr.start === "function", "NativeReadable.start is not a function");
  ptr.start(this[kHighWaterMark]);
  if (cb) cb();
}

// maxToRead can be the highWaterMark (by default) or the remaining amount of the stream to read
// This is so the consumer of the stream can terminate the stream early if they know
// how many bytes they want to read (ie. when reading only part of a file)
// ObjectDefinePrivateProperty(NativeReadable.prototype, "_getRemainingChunk", );
function getRemainingChunk(stream: NativeReadable, maxToRead?: number) {
  maxToRead ??= stream[kHighWaterMark] as number;
  var chunk = stream[kRemainingChunk];
  if ((chunk?.byteLength ?? 0) < MIN_BUFFER_SIZE) {
    var size = maxToRead > MIN_BUFFER_SIZE ? maxToRead : MIN_BUFFER_SIZE;
    stream[kRemainingChunk] = chunk = Buffer.alloc(size);
  }
  $debug(`[${stream.debugId}] getRemainingChunk, ${chunk?.byteLength} bytes`);
  return chunk;
}

function read(this: NativeReadable, maxToRead: number) {
  $debug(`[${this.debugId}] read${this[kPendingRead] ? ", is already pending" : ""}`);
  var ptr = this.$bunNativePtr;
  // Readable called `_read`, so it wants data: make sure the native reader is
  // not paused from a previous `push()===false` (readStart, like net.Socket).
  // Runs even when a pull promise is outstanding so that promise can resolve.
  if (ptr) ptr.setFlowing?.(true);
  if (this[kPendingRead]) {
    return;
  }
  if (!ptr) {
    $debug(`[${this.debugId}] read, no ptr`);
    this.push(null);
    return;
  }
  const deliver = deliverOf(this);
  if (deliver !== undefined) {
    if (!this[kConstructed]) {
      const started: any = ptr.start(this[kHighWaterMark], deliver);
      $debug(`[${this.debugId}] start, initial hwm:`, started);
      this[kConstructed] = true;
      if (started === true) {
        // The bytes that the source had before its start are on their way.
        this[kPendingRead] = true;
        return;
      }
      if (typeof started === "number" && started > 1) {
        this[kHasResized] = true;
        this[kHighWaterMark] = Math.min(this[kHighWaterMark], started);
      }
    }
    const view = getRemainingChunk(this, this[kViewSize] || maxToRead);
    if (ptr.pull(view, this[kCloseState], deliver) === true) {
      this[kPullView] = view;
      this[kPendingRead] = true;
    }
    return;
  }
  if (!this[kConstructed]) {
    const result: any = ptr.start(this[kHighWaterMark]);
    $debug(`[${this.debugId}] start, initial hwm:`, result);
    if (typeof result === "number" && result > 1) {
      this[kHasResized] = true;
      this[kHighWaterMark] = Math.min(this[kHighWaterMark], result);
    }
    if ($isTypedArrayView(result) && result.byteLength > 0) {
      pushAndCheck(this, result);
    }
    const drainResult = ptr.drain();
    this[kConstructed] = true;
    $debug(`[${this.debugId}] drain result: ${drainResult?.byteLength ?? "null"}`);
    if ((drainResult?.byteLength ?? 0) > 0) {
      pushAndCheck(this, drainResult);
    }
  }
  const chunk = getRemainingChunk(this, maxToRead);
  var result = ptr.pull(chunk, this[kCloseState]);
  $assert(result !== undefined);
  $debug(
    `[${this.debugId}] pull ${chunk?.byteLength} bytes, result: ${$isPromise(result) ? "<pending>" : $isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, closeState: ${this[kCloseState][0]}`,
  );
  if ($isPromise(result)) {
    this[kPendingRead] = true;
    return result.then(
      result => {
        $debug(
          `[${this.debugId}] pull, resolved: ${$isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, closeState: ${this[kCloseState][0]}`,
        );
        this[kPendingRead] = false;
        this[kRemainingChunk] = handleResult(this, result, chunk, this[kCloseState][0]);
      },
      reason => {
        errorOrDestroy(this, reason);
      },
    );
  } else {
    this[kRemainingChunk] = handleResult(this, result, chunk, this[kCloseState][0]);
  }
}

// Node's sources never push inside _read(): a libuv handle reports each read, its EOF and its close from a callback of its own, with the
// nextTicks and promise jobs of the one before done. So once something consumes the stream, the native source delivers each result on a
// later turn of the event loop. Before that nobody sees an order, and read() answers at once: by then Node has the bytes in its buffer.
function deliverOf(stream: NativeReadable): Deliver | undefined {
  let deliver = stream[kDeliver];
  if (deliver === undefined) {
    const state = stream._readableState;
    if (state.flowing !== true && !state.readableListening) return undefined;
    deliver = stream[kDeliver] = (result, isClosed, failed) => deliverResult(stream, result, isClosed, failed);
  }
  return deliver;
}

function deliverResult(stream: NativeReadable, result: any, isClosed: boolean, failed: boolean) {
  $debug(
    `[${stream.debugId}] deliver: ${$isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, isClosed: ${isClosed}, failed: ${failed}`,
  );
  const view = stream[kPullView];
  stream[kPullView] = undefined;
  stream[kPendingRead] = false;
  if (failed) {
    errorOrDestroy(stream, result);
    return;
  }
  // A listener can read again before push() returns, so the next read's view is in place first.
  let chunk: Buffer | ArrayBufferView;
  if (typeof result === "number") {
    chunk = view!.subarray(0, result);
    stream[kRemainingChunk] = result < view!.byteLength ? view!.subarray(result) : undefined;
    // A file or a pipe that filled a whole new view has more behind it. Its reader took that in one read while `_read()` pushed,
    // through its own buffer.
    if (result === view!.byteLength && view!.byteOffset === 0 && stream.$bunNativePtr?.setFlowing) {
      stream[kViewSize] = LARGE_VIEW_SIZE;
    }
  } else if (typeof result === "boolean") {
    // The source ended with the read before this one.
    stream[kRemainingChunk] = view;
    stream.push(null);
    // As net.Socket does at its EOF: 'end' also comes for a 'readable' listener that took all the bytes and does not read() again.
    stream.read(0);
    return;
  } else {
    $assert($isTypedArrayView(result), "Invalid result from pull");
    chunk = result;
    stream[kRemainingChunk] = view;
  }
  let threw = true;
  try {
    // The end of the source is the result of the next pull: the push asks for it, also when it has no bytes.
    pushAndCheck(stream, chunk);
    threw = false;
  } finally {
    // The throw of a 'data' listener left push() before its maybeReadMore(). A libuv handle reads on.
    if (threw) process.nextTick(readAfterListenerThrew, stream);
  }
}

function readAfterListenerThrew(stream: NativeReadable) {
  if (!stream.destroyed) stream.read(0);
}

function handleResult(stream: NativeReadable, result: any, chunk: Buffer | undefined, isClosed: boolean) {
  if (typeof result === "number") {
    $debug(`[${stream.debugId}] handleResult(${result})`);
    if (result >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
      adjustHighWaterMark(stream);
    }
    return handleNumberResult(stream, result, chunk, isClosed);
  } else if (typeof result === "boolean") {
    $debug(`[${stream.debugId}] handleResult(${result})`, chunk, isClosed);
    process.nextTick(pushEof, stream);
    return (chunk?.byteLength ?? 0) > 0 ? chunk : undefined;
  } else if ($isTypedArrayView(result)) {
    if (result.byteLength >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
      adjustHighWaterMark(stream);
    }
    return handleArrayBufferViewResult(stream, result, chunk, isClosed);
  } else {
    $assert(false, "Invalid result from pull");
  }
}

// For a stream that nothing consumes yet. After a destroy() before the tick, Node emits 'close' without 'end'.
function pushEof(stream: NativeReadable) {
  if (!stream.destroyed) stream.push(null);
}

// `push()` returning false means the Readable's buffer is at/above hwm (or
// the consumer paused); stop the native reader so kernel backpressure reaches
// the writer (readStop, like net.Socket). The next `_read()` re-enables it.
function pushAndCheck(stream: NativeReadable, chunk: Buffer | ArrayBufferView) {
  if (!stream.push(chunk)) {
    const ptr = stream.$bunNativePtr;
    if (ptr) ptr.setFlowing?.(false);
  }
}

function handleNumberResult(stream: NativeReadable, result: number, chunk: Buffer | undefined, isClosed: boolean) {
  if (result > 0) {
    const slice = chunk!.subarray(0, result);
    chunk = slice.byteLength < chunk!.byteLength ? chunk!.subarray(result) : undefined;
    if (slice.byteLength > 0) {
      pushAndCheck(stream, slice);
    }
  }

  if (isClosed) {
    process.nextTick(pushEof, stream);
  }

  return chunk;
}

function handleArrayBufferViewResult(
  stream: NativeReadable,
  result: ArrayBufferView,
  chunk: Buffer | undefined,
  isClosed: boolean,
) {
  if (result.byteLength > 0) {
    pushAndCheck(stream, result);
  }

  if (isClosed) {
    process.nextTick(pushEof, stream);
  }

  return chunk;
}

function adjustHighWaterMark(stream: NativeReadable) {
  stream[kHighWaterMark] = $min(stream[kHighWaterMark] * 2, 1024 * 1024 * 2);
  stream[kHasResized] = true;
}

function destroy(this: NativeReadable, error: any, cb: (error?: any) => void) {
  const ptr = this.$bunNativePtr;
  if (ptr) {
    // As the close callback of a libuv handle: 'close' comes on a later turn, after the promise jobs of the 'end' listeners.
    // `_destroy` reports its error through the callback.
    ptr.cancel(error, cb && (() => cb(error)));
  } else if (cb) {
    process.nextTick(cb, error);
  }
}

function ref(this: NativeReadable) {
  const ptr = this.$bunNativePtr;
  if (ptr === undefined) return;
  if (this[kRefCount]++ === 0) {
    ptr.updateRef(true);
  }
}

function unref(this: NativeReadable) {
  const ptr = this.$bunNativePtr;
  if (ptr === undefined) return;
  if (this[kRefCount]-- === 1) {
    ptr.updateRef(false);
  }
}

export default { constructNativeReadable };
