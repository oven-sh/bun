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
// The C++ that pulls for a web stream pulls for this one too (BunStreamSource.cpp): its adapter keeps the buffer that `ptr` fills, where no listener reaches it.
const nativePullAdapter: (ptr: NativePtr | undefined) => NativePull | undefined = $newCppFunction(
  "streams/BunStreamConsumers.cpp",
  "jsFunctionNativeReadableAdapter",
  1,
);
// One `ptr.pull()`: what to push, or the promise of the source.
const nativePull: (pull: NativePull | undefined, size: number, closeState: [boolean]) => PullResult | Promise<unknown> =
  $newCppFunction("streams/BunStreamConsumers.cpp", "jsFunctionNativeReadablePull", 3);
// What to push for the value that the promise settled with.
const nativePullSettled: (pull: NativePull | undefined, result: unknown) => PullResult = $newCppFunction(
  "streams/BunStreamConsumers.cpp",
  "jsFunctionNativeReadablePullSettled",
  2,
);
const { errorOrDestroy } = require("internal/streams/destroy");

const kRefCount = Symbol("refCount");
const kCloseState = Symbol("closeState");
const kConstructed = Symbol("constructed");
const kHighWaterMark = Symbol("highWaterMark");
const kPendingRead = Symbol("pendingRead");
const kHasResized = Symbol("hasResized");

let dynamicallyAdjustChunkSize = (_?) => (
  (_ = process.env.BUN_DISABLE_DYNAMIC_CHUNK_SIZE !== "1"),
  (dynamicallyAdjustChunkSize = () => _)
);

/** `JSNativeStreamSourceAdapter` (BunStreamSource.h). */
type NativePull = { readonly __nativePull: unique symbol };
type PullResult = Buffer | Uint8Array | boolean | undefined;

interface NativeReadable extends $Node.Readable {
  $bunNativePtr: NativePtr | undefined;
  $pull: NativePull | undefined;
  $start?: typeof ensureConstructed;
  ref: typeof ref;
  unref: typeof unref;
  [kRefCount]: number;
  [kCloseState]: [boolean];
  [kConstructed]: boolean;
  [kPendingRead]: boolean;
  [kHighWaterMark]: number;
  [kHasResized]: boolean;
  debugId: number;
}

interface NativePtr {
  onClose: () => void;
  onDrain: (chunk: any) => void;
  start: (highWaterMark: number) => number;
  drain: () => any;
  updateRef: (ref: boolean) => void;
  cancel: (error: any) => void;
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
  $putByIdDirectPrivate(stream, "pull", nativePullAdapter(bunNativePtr));
  stream[kRefCount] = 0;
  stream[kConstructed] = false;
  stream[kPendingRead] = false;
  stream[kHasResized] = !dynamicallyAdjustChunkSize();
  stream[kCloseState] = [false];

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

// readStart, as on net.Socket. The pull and its push run on a later tick.
function read(this: NativeReadable) {
  $debug(`[${this.debugId}] read${this[kPendingRead] ? ", is already pending" : ""}`);
  const ptr = this.$bunNativePtr;
  // Make sure the native reader is not paused from a previous `push()===false`.
  // Runs even when a pull promise is outstanding so that promise can resolve.
  if (ptr) ptr.setFlowing?.(true);
  if (this[kPendingRead]) {
    return;
  }
  this[kPendingRead] = true;
  process.nextTick(pump, this);
}

// One pull. `kPendingRead` is cleared before the push.
function pump(stream: NativeReadable) {
  const ptr = stream.$bunNativePtr;
  if (stream.destroyed) {
    stream[kPendingRead] = false;
    return;
  }
  if (!ptr) {
    $debug(`[${stream.debugId}] pump, no ptr`);
    stream[kPendingRead] = false;
    stream.push(null);
    return;
  }
  if (!stream[kConstructed]) {
    let initial: any;
    let drained: any;
    try {
      initial = ptr.start(stream[kHighWaterMark]);
      $debug(`[${stream.debugId}] start, initial hwm:`, initial);
      if (typeof initial === "number" && initial > 1) {
        stream[kHasResized] = true;
        stream[kHighWaterMark] = Math.min(stream[kHighWaterMark], initial);
      }
      drained = ptr.drain();
    } catch (err) {
      stream[kPendingRead] = false;
      errorOrDestroy(stream, err as Error);
      return;
    }
    stream[kConstructed] = true;
    $debug(`[${stream.debugId}] drain result: ${drained?.byteLength ?? "null"}`);
    if (!$isTypedArrayView(initial) || initial.byteLength === 0) initial = undefined;
    if ((drained?.byteLength ?? 0) === 0) drained = undefined;
    if (initial !== undefined || drained !== undefined) {
      stream[kPendingRead] = false;
      if (initial !== undefined) deliver(stream, initial, false);
      if (drained !== undefined) deliver(stream, drained, false);
      return;
    }
  }
  const pull = stream.$pull;
  let result: PullResult | Promise<unknown>;
  try {
    result = nativePull(pull, stream._readableState.highWaterMark, stream[kCloseState]);
  } catch (err) {
    stream[kPendingRead] = false;
    errorOrDestroy(stream, err as Error);
    return;
  }
  $debug(
    `[${stream.debugId}] pull, result: ${$isPromise(result) ? "<pending>" : $isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, closeState: ${stream[kCloseState][0]}`,
  );
  if ($isPromise(result)) {
    result.then(
      result => {
        $debug(
          `[${stream.debugId}] pull, resolved: ${$isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, closeState: ${stream[kCloseState][0]}`,
        );
        stream[kPendingRead] = false;
        let chunk: PullResult;
        try {
          chunk = nativePullSettled(pull, result);
        } catch (err) {
          errorOutOfPromise(stream, err);
          return;
        }
        try {
          deliver(stream, chunk, stream[kCloseState][0]);
        } catch (err) {
          // Out of the promise, so it is an uncaughtException, not a rejection.
          process.nextTick(rethrow, err);
        }
      },
      reason => {
        stream[kPendingRead] = false;
        errorOutOfPromise(stream, reason);
      },
    );
    return;
  }
  stream[kPendingRead] = false;
  deliver(stream, result, stream[kCloseState][0]);
}

// A listener that throws out of `push()` skips `maybeReadMore`: ask for more here.
function deliver(stream: NativeReadable, chunk: PullResult, isClosed: boolean) {
  try {
    handleResult(stream, chunk, isClosed);
  } catch (err) {
    process.nextTick(readAfterThrow, stream);
    throw err;
  }
}

// Without autoDestroy, 'error' is emitted at once: a listener that throws is an uncaughtException, not a rejection.
function errorOutOfPromise(stream: NativeReadable, err: unknown) {
  try {
    errorOrDestroy(stream, err as Error);
  } catch (thrown) {
    process.nextTick(rethrow, thrown);
  }
}

function readAfterThrow(stream: NativeReadable) {
  if (!stream.destroyed) stream.read(0);
}

function rethrow(err: any) {
  throw err;
}

// Pushes `chunk`, and queues EOF after it.
function handleResult(stream: NativeReadable, chunk: PullResult, isClosed: boolean) {
  $debug(`[${stream.debugId}] handleResult(${$isTypedArrayView(chunk) ? `<${chunk.byteLength} bytes>` : chunk})`);
  if (typeof chunk === "boolean") {
    process.nextTick(pushEof, stream);
    return;
  }
  try {
    if (chunk !== undefined) {
      if (chunk.byteLength >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
        adjustHighWaterMark(stream);
      }
      if (chunk.byteLength > 0) {
        pushAndCheck(stream, chunk);
      }
    }
  } finally {
    if (isClosed) {
      process.nextTick(pushEof, stream);
    }
  }
}

// EOF is pushed a tick after the last chunk. After a destroy() in between, Node emits 'close' without 'end'.
function pushEof(stream: NativeReadable) {
  if (!stream.destroyed) stream.push(null);
}

// `push()` returning false means the Readable's buffer is at/above hwm (or
// the consumer paused); stop the native reader so kernel backpressure reaches
// the writer (readStop, like net.Socket). The next `_read()` re-enables it.
function pushAndCheck(stream: NativeReadable, chunk: Buffer | ArrayBufferView) {
  // A listener that asked for more (`_read()` during the push) keeps the reader running.
  if (!stream.push(chunk) && !stream[kPendingRead]) {
    const ptr = stream.$bunNativePtr;
    if (ptr) ptr.setFlowing?.(false);
  }
}

function adjustHighWaterMark(stream: NativeReadable) {
  stream[kHighWaterMark] = $min(stream[kHighWaterMark] * 2, 1024 * 1024 * 2);
  stream[kHasResized] = true;
}

function destroy(this: NativeReadable, error: any, cb: () => void) {
  const ptr = this.$bunNativePtr;
  if (ptr) {
    ptr.cancel(error);
  }
  // The adapter keeps the buffer of the pulls.
  $putByIdDirectPrivate(this, "pull", undefined);
  if (cb) {
    // `_destroy` reports its error through the callback.
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
