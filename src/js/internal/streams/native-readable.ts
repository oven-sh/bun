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

const MIN_BUFFER_SIZE = 512;
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
  debugId: number;
}

interface NativePtr {
  onClose: () => void;
  onDrain: (chunk: any) => void;
  start: (highWaterMark: number) => number;
  drain: () => any;
  pull: (view: any, closer: any) => any;
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

// `_read()` is readStart, as on net.Socket: it resumes the native reader and
// schedules one pull on a later tick. It never pushes. Node's native sources
// (libuv pipes, fs.read) all push from a later event loop turn, and Readable's
// state machine relies on that: a `push()` inside `_read()` while `needReadable`
// is false lands in the buffer without a 'readable' event, and a flowing stream
// holds that chunk behind the one it is about to emit.
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

// One pull from the native source. `kPendingRead` is set until the result is
// in hand, and cleared before any push, so a 'data' listener that throws
// leaves the stream able to pull again. Readable asks for the next pull
// (`maybeReadMore`, `flow()`), as it does for Node's async sources.
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
      if (initial !== undefined) deliver(stream, initial, undefined, false);
      if (drained !== undefined) deliver(stream, drained, undefined, false);
      return;
    }
  }
  let chunk: Buffer | undefined;
  let result: any;
  try {
    chunk = getRemainingChunk(stream, stream._readableState.highWaterMark);
    result = ptr.pull(chunk, stream[kCloseState]);
  } catch (err) {
    stream[kPendingRead] = false;
    errorOrDestroy(stream, err as Error);
    return;
  }
  $assert(result !== undefined);
  $debug(
    `[${stream.debugId}] pull ${chunk?.byteLength} bytes, result: ${$isPromise(result) ? "<pending>" : $isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, closeState: ${stream[kCloseState][0]}`,
  );
  if ($isPromise(result)) {
    result.then(
      result => {
        $debug(
          `[${stream.debugId}] pull, resolved: ${$isTypedArrayView(result) ? `<${result.byteLength} bytes>` : result}, closeState: ${stream[kCloseState][0]}`,
        );
        stream[kPendingRead] = false;
        try {
          deliver(stream, result, chunk, stream[kCloseState][0]);
        } catch (err) {
          // Leave the promise so the throw reaches 'uncaughtException', as a
          // throw from a libuv read callback does.
          process.nextTick(rethrow, err);
        }
      },
      reason => {
        stream[kPendingRead] = false;
        errorOrDestroy(stream, reason);
      },
    );
    return;
  }
  stream[kPendingRead] = false;
  deliver(stream, result, chunk, stream[kCloseState][0]);
}

// Pushes one pull result. A listener that throws out of `push()` leaves
// before Readable asks for more (`maybeReadMore`), so ask on its behalf:
// Node's native sources keep reading after such a throw.
function deliver(stream: NativeReadable, result: any, chunk: Buffer | undefined, isClosed: boolean) {
  try {
    handleResult(stream, result, chunk, isClosed);
  } catch (err) {
    process.nextTick(readAfterThrow, stream);
    throw err;
  }
}

function readAfterThrow(stream: NativeReadable) {
  if (!stream.destroyed) stream.read(0);
}

function rethrow(err: any) {
  throw err;
}

// Stores the unused part of `chunk` for the next pull before it pushes, so a
// throw from a listener cannot hand that part out again. EOF is queued after
// the push, so the last chunk's 'readable' runs before the stream ends.
function handleResult(stream: NativeReadable, result: any, chunk: Buffer | undefined, isClosed: boolean) {
  if (typeof result === "number") {
    $debug(`[${stream.debugId}] handleResult(${result})`);
    if (result >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
      adjustHighWaterMark(stream);
    }
    handleNumberResult(stream, result, chunk, isClosed);
  } else if (typeof result === "boolean") {
    $debug(`[${stream.debugId}] handleResult(${result})`, chunk, isClosed);
    stream[kRemainingChunk] = (chunk?.byteLength ?? 0) > 0 ? chunk : undefined;
    process.nextTick(pushEof, stream);
  } else if ($isTypedArrayView(result)) {
    if (result.byteLength >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
      adjustHighWaterMark(stream);
    }
    handleArrayBufferViewResult(stream, result, chunk, isClosed);
  } else {
    $assert(false, "Invalid result from pull");
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
  if (!stream.push(chunk)) {
    const ptr = stream.$bunNativePtr;
    if (ptr) ptr.setFlowing?.(false);
  }
}

function handleNumberResult(stream: NativeReadable, result: number, chunk: Buffer | undefined, isClosed: boolean) {
  let slice: Buffer | undefined;
  if (result > 0) {
    slice = chunk!.subarray(0, result);
    chunk = slice.byteLength < chunk!.byteLength ? chunk!.subarray(result) : undefined;
  }
  stream[kRemainingChunk] = chunk;
  try {
    if (slice !== undefined && slice.byteLength > 0) {
      pushAndCheck(stream, slice);
    }
  } finally {
    if (isClosed) {
      process.nextTick(pushEof, stream);
    }
  }
}

function handleArrayBufferViewResult(
  stream: NativeReadable,
  result: ArrayBufferView,
  chunk: Buffer | undefined,
  isClosed: boolean,
) {
  stream[kRemainingChunk] = chunk;
  try {
    if (result.byteLength > 0) {
      pushAndCheck(stream, result);
    }
  } finally {
    if (isClosed) {
      process.nextTick(pushEof, stream);
    }
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
