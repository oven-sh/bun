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
const kReading = Symbol("reading");

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
  /** Handle mode: the source's reader is started. */
  [kReading]?: boolean;
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
  setReadCallback?: (callback: ReadCallback) => boolean;
}

// A source in handle mode calls it with each chunk, with the error when a read failed, with neither at the end. `false` stops its reader until `setFlowing(true)`.
type ReadCallback = (chunk: Buffer | null | undefined, error?: Error) => boolean | void;

let debugId = 0;

// `handleMode` (child stdio): the source calls back with each chunk it reads, as a libuv handle does in Node, and `_read()` only starts it.
function constructNativeReadable(
  readableStream: ReadableStream,
  options: $Node.ReadableOptions,
  handleMode: boolean = false,
): NativeReadable {
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

  if (handleMode && registerReadCallback(stream, bunNativePtr)) {
    stream[kReading] = false;
    stream._read = readStart;
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
        handleResult(this, result, chunk, this[kCloseState][0]);
      },
      reason => {
        errorOrDestroy(this, reason);
      },
    );
  } else {
    handleResult(this, result, chunk, this[kCloseState][0]);
  }
}

// setReadCallback is read off the class of `ptr`, not off `ptr`: a source whose class has none would answer with what a program put on Object.prototype.
function registerReadCallback(stream: NativeReadable, ptr: NativePtr | undefined): boolean {
  if (!$isObject(ptr)) return false;
  const proto = $getPrototypeOf(ptr) as NativePtr | null;
  if (proto === null) return false;
  const setReadCallback = $getByIdDirect(proto, "setReadCallback");
  if (!$isCallable(setReadCallback)) return false;
  const callback: ReadCallback = (chunk, error) => onRead(stream, chunk, error);
  return setReadCallback.$call(ptr, callback);
}

// Handle mode's `_read()`, as net.Socket's: it starts the reader unless it is started. It pushes nothing: chunks come through onRead() on later turns of the event loop.
function readStart(this: NativeReadable) {
  $debug(`[${this.debugId}] readStart${this[kReading] ? ", is already reading" : ""}`);
  if (this[kReading]) return;
  this[kReading] = true;
  this.$bunNativePtr!.setFlowing!(true);
}

// The source calls this from the event loop: what a 'data' listener throws goes to it, and the listener's ticks and promise jobs run before the next call.
function onRead(stream: NativeReadable, chunk: Buffer | null | undefined, error?: Error) {
  if (chunk) {
    if (stream.push(chunk)) return true;
    // The source stops its reader for this `false`: the next `_read()` has to start it again.
    stream[kReading] = false;
    return false;
  }
  if (error) stream.destroy(error);
  else stream.push(null);
}

// Only handleNumberResult advances kRemainingChunk, before push(): a listener can pull again or throw.
function handleResult(stream: NativeReadable, result: any, chunk: Buffer | undefined, isClosed: boolean) {
  if (typeof result === "number") {
    $debug(`[${stream.debugId}] handleResult(${result})`);
    if (result >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
      adjustHighWaterMark(stream);
    }
    handleNumberResult(stream, result, chunk, isClosed);
  } else if (typeof result === "boolean") {
    $debug(`[${stream.debugId}] handleResult(${result})`, chunk, isClosed);
    process.nextTick(pushEof, stream);
  } else if ($isTypedArrayView(result)) {
    if (result.byteLength >= stream[kHighWaterMark] && !stream[kHasResized] && !isClosed) {
      adjustHighWaterMark(stream);
    }
    handleArrayBufferViewResult(stream, result, isClosed);
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
  if (result > 0) {
    const slice = chunk!.subarray(0, result);
    stream[kRemainingChunk] = slice.byteLength < chunk!.byteLength ? chunk!.subarray(result) : undefined;
    if (slice.byteLength > 0) {
      pushAndCheck(stream, slice);
    }
  }

  if (isClosed) {
    process.nextTick(pushEof, stream);
  }
}

function handleArrayBufferViewResult(stream: NativeReadable, result: ArrayBufferView, isClosed: boolean) {
  if (result.byteLength > 0) {
    pushAndCheck(stream, result);
  }

  if (isClosed) {
    process.nextTick(pushEof, stream);
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
  dropReadAhead(this);
  if (cb) {
    // `_destroy` reports its error through the callback.
    process.nextTick(cb, error);
  }
}

// A pulling `_read()` pushes synchronously, so flow() stays one chunk ahead of the 'data' listener. Node's async sources do not. In handle mode only a pause leaves chunks here.
function dropReadAhead(stream: NativeReadable) {
  const state = stream._readableState;
  // Paused: Node has this buffered too, and a later read() returns it.
  if (!state.flowing) return;
  // Ended: the buffer is all that is left, and 'end' must not follow dropped data.
  if (state.ended) return;
  // Inside `_read()` the source failed: the bytes it read before the error are still delivered.
  if (state.sync) return;
  state.buffer.length = 0;
  state.bufferIndex = 0;
  state.length = 0;
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
