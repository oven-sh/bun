// Hardcoded module "node:zlib"

const BufferModule = require("node:buffer");

const crc32 = $bindgen("node_zlib_binding.bind.ts", "crc32");
type NativeConstructor<T> = $Bindgen.CompressionStreamConstructor<T & ZlibHandle>;
const NativeZlib = $bindgen("node_zlib_binding.bind.ts", "NativeZlib") as NativeConstructor<$Bindgen.NativeZlib>;
const NativeBrotli = $bindgen("node_zlib_binding.bind.ts", "NativeBrotli") as NativeConstructor<$Bindgen.NativeBrotli>;
const NativeZstd = $bindgen("node_zlib_binding.bind.ts", "NativeZstd") as NativeConstructor<$Bindgen.NativeZstd>;

const ObjectKeys = Object.keys;
const ArrayPrototypePush = Array.prototype.push;
const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectFreeze = Object.freeze;
const TypedArrayPrototypeFill = Uint8Array.prototype.fill;
const ArrayPrototypeForEach = Array.prototype.forEach;
const NumberIsNaN = Number.isNaN;
const NumberIsInteger = Number.isInteger;
const MathMax = Math.max;

const isArrayBufferView = ArrayBuffer.isView;
const isAnyArrayBuffer = (b: unknown): b is ArrayBuffer | SharedArrayBuffer =>
  b instanceof ArrayBuffer || b instanceof SharedArrayBuffer;
const kMaxLength = $requireMap.$get("buffer")?.exports.kMaxLength ?? BufferModule.kMaxLength;

const { Transform, finished } = require("node:stream");
const owner_symbol = Symbol("owner_symbol");
const { checkRangesOrGetDefault, validateFunction, validateFiniteNumber } = require("internal/validators");

const kFlushFlag = Symbol("kFlushFlag");
const kAfterFlush = Symbol("kAfterFlush");
const kError = Symbol("kError");
const kFlushBound = Symbol("kFlushBound");

const { zlib: constants } = process.binding("constants");
// prettier-ignore
const {
  // Zlib flush levels
  Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH,
  // Zlib option values
  Z_MIN_CHUNK, Z_MIN_WINDOWBITS, Z_MAX_WINDOWBITS, Z_MIN_LEVEL, Z_MAX_LEVEL, Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL,
  Z_DEFAULT_CHUNK, Z_DEFAULT_COMPRESSION, Z_DEFAULT_STRATEGY, Z_DEFAULT_WINDOWBITS, Z_DEFAULT_MEMLEVEL, Z_FIXED,
  // Node's compression stream modes (node_zlib_mode)
  DEFLATE, DEFLATERAW, INFLATE, INFLATERAW, GZIP, GUNZIP, UNZIP, BROTLI_DECODE, BROTLI_ENCODE, ZSTD_COMPRESS, ZSTD_DECOMPRESS,
  // Brotli operations (~flush levels)
  BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_FLUSH, BROTLI_OPERATION_FINISH, BROTLI_OPERATION_EMIT_METADATA,
  // Zstd end directives (~flush levels)
  ZSTD_e_continue, ZSTD_e_flush, ZSTD_e_end,
} = constants;

// Translation table for return codes.
const codes = {
  Z_OK: constants.Z_OK,
  Z_STREAM_END: constants.Z_STREAM_END,
  Z_NEED_DICT: constants.Z_NEED_DICT,
  Z_ERRNO: constants.Z_ERRNO,
  Z_STREAM_ERROR: constants.Z_STREAM_ERROR,
  Z_DATA_ERROR: constants.Z_DATA_ERROR,
  Z_MEM_ERROR: constants.Z_MEM_ERROR,
  Z_BUF_ERROR: constants.Z_BUF_ERROR,
  Z_VERSION_ERROR: constants.Z_VERSION_ERROR,
};
for (const ckey of ObjectKeys(codes)) {
  codes[codes[ckey]] = ckey;
}

function zlibBuffer(engine: $Node.ZlibBase, buffer: ZlibInput, callback: ZlibCallback) {
  validateFunction(callback, "callback");
  // Streams do not support non-Uint8Array ArrayBufferViews yet. Convert it to a Buffer without copying.
  if (isArrayBufferView(buffer)) {
    buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else if (isAnyArrayBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }
  engine.buffers = null;
  engine.nread = 0;
  engine.cb = callback;
  engine.on("data", zlibBufferOnData);
  engine.on("error", zlibBufferOnError);
  engine.on("end", zlibBufferOnEnd);
  engine.end(buffer);
}

const emptyOutBuffer = Buffer.from(new ArrayBuffer());
function ignoreResult() {}

function takeCallback(engine: $Node.ZlibBase): ZlibCallback {
  const callback = engine.cb;
  engine.cb = ignoreResult;
  engine.buffers = null;
  engine._outBuffer = emptyOutBuffer;
  return callback;
}

function zlibBufferOnData(this: $Node.ZlibBase, chunk: Buffer) {
  if (!this.buffers) this.buffers = [chunk];
  else ArrayPrototypePush.$call(this.buffers, chunk);
  this.nread += chunk.length;
  const maxOutputLength = this._maxOutputLength;
  if (this.nread > maxOutputLength) {
    this.close();
    this.removeAllListeners("end");
    takeCallback(this).$call(this, $ERR_BUFFER_TOO_LARGE(maxOutputLength));
  }
}

function zlibBufferOnError(this: $Node.ZlibBase, err: Error) {
  this.removeAllListeners("end");
  takeCallback(this).$call(this, err);
}

function zlibBufferOnEnd(this: $Node.ZlibBase) {
  let buf: Buffer;
  if (this.nread === 0) {
    buf = Buffer.alloc(0);
  } else {
    const bufs = this.buffers!;
    buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs, this.nread);
  }
  this.close();
  const callback = takeCallback(this);
  if (this._info) callback.$call(this, null, { buffer: buf, engine: this });
  else callback.$call(this, null, buf);
}

function zlibBufferSync(engine: $Node.ZlibBase, buffer: ZlibInput) {
  if (typeof buffer === "string") {
    buffer = Buffer.from(buffer) as Buffer;
  } else if (!isArrayBufferView(buffer)) {
    if (isAnyArrayBuffer(buffer)) {
      buffer = Buffer.from(buffer) as Buffer;
    } else {
      throw $ERR_INVALID_ARG_TYPE("buffer", "string, Buffer, TypedArray, DataView, or ArrayBuffer", buffer);
    }
  }
  buffer = processChunkSync(engine, buffer, engine._finishFlushFlag);
  if (engine._info) return { buffer, engine };
  return buffer;
}

function zlibOnError(this: ZlibHandle, message: string, errno: number, code: string) {
  const self = this[owner_symbol];
  // There is no way to cleanly recover. Continuing only obscures problems.
  const error: ZlibError = new Error(message);
  error.errno = errno;
  error.code = code;
  self.destroy(error);
  self[kError] = error;
}

const FLUSH_BOUND = [
  [Z_NO_FLUSH, Z_BLOCK],
  [BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_EMIT_METADATA],
  [ZSTD_e_continue, ZSTD_e_end],
];
const FLUSH_BOUND_IDX_NORMAL = 0;
const FLUSH_BOUND_IDX_BROTLI = 1;
const FLUSH_BOUND_IDX_ZSTD = 2;

interface ZlibError extends Error {
  errno?: number;
}

interface FlushOptions {
  flush: number;
  finishFlush: number;
  fullFlush: number;
}

/** One of the native compressors, with what this module keeps on it for `processCallback`. */
interface ZlibHandle extends $Bindgen.CompressionStream {
  [owner_symbol]: $Node.ZlibBase;
  /** Set only while a write is on the threadpool. */
  buffer: (View & { [kAfterFlush]?: () => void }) | null;
  cb: () => void;
  afterWrite?: (() => void) | null;
  availOutBefore: number;
  availInBefore: number;
  inOff: number;
  flushFlag: number;
}

type View = $Node.AnyView;
type ZlibInput = string | View | ArrayBuffer | SharedArrayBuffer;
type ZlibResult = Buffer | { buffer: Buffer; engine: $Node.ZlibBase };
type ZlibCallback = (error: Error | null, result?: ZlibResult) => void;

// `flush` is a number here and a function for `Transform`, which takes only a function from its options.
interface ZlibOptions extends Omit<$Node.TransformOptions, "flush" | "encoding"> {
  encoding?: string | null;
  flush?: number;
  finishFlush?: number;
  chunkSize?: number;
  windowBits?: number | null;
  level?: number;
  memLevel?: number;
  strategy?: number;
  dictionary?: View | ArrayBuffer | SharedArrayBuffer;
  info?: boolean;
  maxOutputLength?: number;
  params?: Record<string, number | boolean>;
  pledgedSrcSize?: number;
}

declare global {
  namespace $Node {
    interface ZlibBase extends Transform {
      [kError]: ZlibError | null;
      [kFlushBound]: number[];
      bytesWritten: number;
      _handle: ZlibHandle | null;
      _writeState: Uint32Array;
      _outBuffer: Buffer;
      _outOffset: number;
      _chunkSize: number;
      _defaultFlushFlag: number;
      _finishFlushFlag: number;
      _defaultFullFlushFlag: number;
      _info: boolean | undefined;
      _maxOutputLength: number;
      reset(): void;
      flush(kind?: number | (() => void), callback?: () => void): void;
      close(callback?: () => void): void;
      _processChunk(chunk: View, flushFlag: number, cb?: () => void): Buffer | undefined;
      // What `zlibBuffer` keeps on the engine it drives.
      buffers: Buffer[] | null;
      nread: number;
      cb: ZlibCallback;
    }

    interface Zlib extends ZlibBase {
      _level: number;
      _strategy: number;
      params(level: number, strategy: number, callback: () => void): void;
    }
  }
}

interface ZlibBaseConstructor {
  new (opts: ZlibOptions | undefined, mode: number, handle: ZlibHandle, flushOptions: FlushOptions): $Node.ZlibBase;
  prototype: any;
}

// The base class for all Zlib-style streams.
function ZlibBase(
  this: $Node.ZlibBase,
  opts: ZlibOptions | undefined,
  mode: number,
  handle: ZlibHandle,
  { flush, finishFlush, fullFlush }: FlushOptions,
) {
  let chunkSize = Z_DEFAULT_CHUNK;
  let maxOutputLength = kMaxLength;
  // The ZlibBase class is not exported to user land, the mode should only be passed in by us.
  $assert(typeof mode === "number");
  $assert(mode >= DEFLATE && mode <= ZSTD_DECOMPRESS);

  let flushBoundIdx: number;
  if (mode === BROTLI_ENCODE || mode === BROTLI_DECODE) {
    flushBoundIdx = FLUSH_BOUND_IDX_BROTLI;
  } else if (mode === ZSTD_COMPRESS || mode === ZSTD_DECOMPRESS) {
    flushBoundIdx = FLUSH_BOUND_IDX_ZSTD;
  } else {
    flushBoundIdx = FLUSH_BOUND_IDX_NORMAL;
  }

  if (opts) {
    chunkSize = opts.chunkSize!;
    if (!validateFiniteNumber(chunkSize, "options.chunkSize")) {
      chunkSize = Z_DEFAULT_CHUNK;
    } else if (chunkSize < Z_MIN_CHUNK) {
      throw $ERR_OUT_OF_RANGE("options.chunkSize", `>= ${Z_MIN_CHUNK}`, chunkSize);
    }

    // prettier-ignore
    flush = checkRangesOrGetDefault(opts.flush, "options.flush", FLUSH_BOUND[flushBoundIdx][0], FLUSH_BOUND[flushBoundIdx][1], flush);
    // prettier-ignore
    finishFlush = checkRangesOrGetDefault(opts.finishFlush, "options.finishFlush", FLUSH_BOUND[flushBoundIdx][0], FLUSH_BOUND[flushBoundIdx][1], finishFlush);
    // prettier-ignore
    maxOutputLength = checkRangesOrGetDefault(opts.maxOutputLength, "options.maxOutputLength", 1, kMaxLength, kMaxLength);

    if (opts.encoding || opts.objectMode || opts.writableObjectMode) {
      opts = { ...opts };
      opts.encoding = null;
      opts.objectMode = false;
      opts.writableObjectMode = false;
    }
  }

  Transform.$apply(this, [{ autoDestroy: true, ...(opts as Omit<ZlibOptions, "flush"> | undefined) }]);
  this[kError] = null;
  this.bytesWritten = 0;
  this._handle = handle;
  handle[owner_symbol] = this;
  // Used by processCallback() and zlibOnError()
  handle.onerror = zlibOnError;
  this._outBuffer = Buffer.allocUnsafe(chunkSize);
  this._outOffset = 0;

  this._chunkSize = chunkSize;
  this._defaultFlushFlag = flush;
  this._finishFlushFlag = finishFlush;
  this._defaultFullFlushFlag = fullFlush;
  this._info = opts && opts.info;
  this._maxOutputLength = maxOutputLength;
}
$toClass(ZlibBase, "ZlibBase", Transform);
ZlibBase.prototype[kFlushBound] = FLUSH_BOUND[FLUSH_BOUND_IDX_NORMAL];

ObjectDefineProperty(ZlibBase.prototype, "_closed", {
  configurable: true,
  enumerable: true,
  get(this: $Node.ZlibBase) {
    return !this._handle;
  },
});

// `bytesRead` made sense as a name when looking from the zlib engine's
// perspective, but it is inconsistent with all other streams exposed by Node.js
// that have this concept, where it stands for the number of bytes read
// *from* the stream (that is, net.Socket/tls.Socket & file system streams).
ObjectDefineProperty(ZlibBase.prototype, "bytesRead", {
  configurable: true,
  get: function (this: $Node.ZlibBase) {
    return this.bytesWritten;
  },
  set: function (this: $Node.ZlibBase, value: number) {
    this.bytesWritten = value;
  },
});

ZlibBase.prototype.reset = function (this: $Node.ZlibBase) {
  $assert(this._handle, "zlib binding closed");
  return this._handle.reset();
};

// This is the _flush function called by the transform class, internally, when the last chunk has been written.
ZlibBase.prototype._flush = function (this: $Node.ZlibBase, callback: () => void) {
  this._transform(Buffer.alloc(0), "", callback);
};

// Force Transform compat behavior.
ZlibBase.prototype._final = function (this: $Node.ZlibBase, callback: () => void) {
  callback();
};

// If a flush is scheduled while another flush is still pending, a way to figure out which one is the "stronger" flush is needed.
// This is currently only used to figure out which flush flag to use for the last chunk.
// Roughly, the following holds:
// Z_NO_FLUSH (< Z_TREES) < Z_BLOCK < Z_PARTIAL_FLUSH < Z_SYNC_FLUSH < Z_FULL_FLUSH < Z_FINISH
const flushiness: number[] = [];
const kFlushFlagList = [Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH];
for (let i = 0; i < kFlushFlagList.length; i++) {
  flushiness[kFlushFlagList[i]] = i;
}

function maxFlush(a: number, b: number) {
  return flushiness[a] > flushiness[b] ? a : b;
}

// Set up a list of 'special' buffers that can be written using .write()
// from the .flush() code as a way of introducing flushing operations into the
// write sequence.
type Chunk = Buffer & { [kFlushFlag]?: number };
const kFlushBuffers: Chunk[] = [];
{
  const dummyArrayBuffer = new ArrayBuffer();
  for (const flushFlag of kFlushFlagList) {
    kFlushBuffers[flushFlag] = Buffer.from(dummyArrayBuffer);
    kFlushBuffers[flushFlag][kFlushFlag] = flushFlag;
  }
}

ZlibBase.prototype.flush = function (this: $Node.ZlibBase, kind?: number | (() => void), callback?: () => void) {
  if (typeof kind === "function" || (kind === undefined && !callback)) {
    callback = kind;
    kind = this._defaultFullFlushFlag;
  }
  if (this.writableFinished) {
    if (callback) process.nextTick(callback);
  } else if (this.writableEnded) {
    if (callback) this.once("end", callback);
  } else {
    if (!this.destroyed) {
      // "2" and 2n index the same flush buffer as 2.
      kind = kFlushBuffers[kind!]?.[kFlushFlag] ?? kind;
      const flushBound = this[kFlushBound];
      kind = checkRangesOrGetDefault(kind, "kind", flushBound[0], flushBound[1], this._defaultFullFlushFlag);
    }
    this.write(kFlushBuffers[kind!], "", callback);
  }
};

ZlibBase.prototype.close = function (this: $Node.ZlibBase, callback?: () => void) {
  if (callback) finished(this, callback);
  this.destroy();
};

ZlibBase.prototype._destroy = function (this: $Node.ZlibBase, err: Error | null, callback: $Node.ErrorCallback) {
  _close(this);
  callback(err);
};

ZlibBase.prototype._transform = function (this: $Node.ZlibBase, chunk: Chunk, encoding: string, cb: () => void) {
  let flushFlag = this._defaultFlushFlag;
  // We use a 'fake' zero-length chunk to carry information about flushes from the public API to the actual stream implementation.
  if (typeof chunk[kFlushFlag] === "number") {
    flushFlag = chunk[kFlushFlag];
  }

  // For the last chunk, also apply `_finishFlushFlag`.
  if (this.writableEnded && this.writableLength === chunk.byteLength) {
    flushFlag = maxFlush(flushFlag, this._finishFlushFlag);
  }
  processChunk(this, chunk, flushFlag, cb);
};

ZlibBase.prototype._processChunk = function (this: $Node.ZlibBase, chunk: View, flushFlag: number, cb?: () => void) {
  // _processChunk() is left for backwards compatibility
  if (typeof cb === "function") processChunk(this, chunk, flushFlag, cb);
  else return processChunkSync(this, chunk, flushFlag);
};

// Takes `have` bytes at `offset` out of an output chunk, without `slice` where possible. A slice gives
// the chunk an ArrayBuffer. JSC then counts the chunk as allocated a second time, and only a full
// collection takes it out of the heap size again, so full collections come often. A slice also keeps
// the whole chunk alive with the result. nativeDecodePullResult in BunStreamSource.cpp has the same rule.
function takeOutput(buffer: Buffer, offset: number, have: number): Buffer {
  // A full chunk: hand it over. The caller replaces an exhausted chunk.
  if (offset === 0 && have === buffer.byteLength) return buffer;
  // At most one default chunk: copy it out. A fractional chunkSize gives fractional offsets, which
  // `slice` truncates and `copyBytesFrom` rejects.
  if (have <= Z_DEFAULT_CHUNK && NumberIsInteger(offset) && NumberIsInteger(have)) {
    return Buffer.copyBytesFrom(buffer, offset, have);
  }
  return buffer.slice(offset, offset + have);
}

function processChunkSync(self: $Node.ZlibBase, chunk: View, flushFlag: number): Buffer {
  let availInBefore = chunk.byteLength;
  let availOutBefore = self._chunkSize - self._outOffset;
  let inOff = 0;
  let availOutAfter: number;
  let availInAfter: number;

  const buffers: Buffer[] = [];
  let nread = 0;
  let inputRead = 0;
  const state = self._writeState;
  const handle = self._handle!;
  let buffer = self._outBuffer;
  let offset = self._outOffset;
  const chunkSize = self._chunkSize;

  let error: Error | undefined;
  self.on("error", function onError(er: Error) {
    error = er;
  });

  while (true) {
    handle.writeSync(
      flushFlag,
      chunk, // in
      inOff, // in_off
      availInBefore, // in_len
      buffer, // out
      offset, // out_off
      availOutBefore, // out_len
    );
    if (error) {
      if (typeof error === "string") {
        error = new Error(error);
      } else if (!Error.isError(error)) {
        error = new Error(String(error));
      }
      throw error;
    } else if (self[kError]) throw self[kError];

    availOutAfter = state[0];
    availInAfter = state[1];

    const inDelta = availInBefore - availInAfter;
    inputRead += inDelta;

    const have = availOutBefore - availOutAfter;
    if (have > 0) {
      const out = takeOutput(buffer, offset, have);
      offset += have;
      ArrayPrototypePush.$call(buffers, out);
      nread += out.byteLength;

      const maxOutputLength = self._maxOutputLength;
      if (nread > maxOutputLength) {
        _close(self);
        throw $ERR_BUFFER_TOO_LARGE(maxOutputLength);
      }
    } else {
      $assert(have === 0, "have should not go down");
    }

    // Exhausted the output buffer, or used all the input create a new one.
    if (availOutAfter === 0 || offset >= chunkSize) {
      availOutBefore = chunkSize;
      offset = 0;
      buffer = Buffer.allocUnsafe(chunkSize);
    }

    if (availOutAfter === 0) {
      // Not actually done. Need to reprocess.
      // Also, update the availInBefore to the availInAfter value,
      // so that if we have to hit it a third (fourth, etc.) time,
      // it'll have the correct byte counts.
      inOff += inDelta;
      availInBefore = availInAfter;
    } else {
      break;
    }
  }

  self.bytesWritten = inputRead;
  _close(self);

  if (nread === 0) return Buffer.alloc(0);

  return buffers.length === 1 ? buffers[0] : Buffer.concat(buffers, nread);
}

function processChunk(self: $Node.ZlibBase, chunk: View, flushFlag: number, cb: () => void) {
  const handle = self._handle;
  if (!handle) return process.nextTick(cb);

  handle.buffer = chunk;
  handle.cb = cb;
  handle.availOutBefore = self._chunkSize - self._outOffset;
  handle.availInBefore = chunk.byteLength;
  handle.inOff = 0;
  handle.flushFlag = flushFlag;

  handle.write(
    flushFlag, // flush
    chunk, // in
    0, // in_off
    handle.availInBefore, // in_len
    self._outBuffer, // out
    self._outOffset, // out_off
    handle.availOutBefore, // out_len
  );
}

function processCallback(this: ZlibHandle) {
  // This callback's context (`this`) is the `_handle` (ZCtx) object. It is
  // important to null out the values once they are no longer needed since
  // `_handle` can stay in memory long after the buffer is needed.
  const handle = this;
  const self = this[owner_symbol];
  const state = self._writeState;

  if (self.destroyed) {
    this.buffer = null;
    this.cb();
    return;
  }

  const availOutAfter = state[0];
  const availInAfter = state[1];

  const inDelta = handle.availInBefore - availInAfter;
  self.bytesWritten += inDelta;

  const have = handle.availOutBefore - availOutAfter;
  let streamBufferIsFull = false;
  if (have > 0) {
    const out = takeOutput(self._outBuffer, self._outOffset, have);
    self._outOffset += have;
    streamBufferIsFull = !self.push(out);
  } else {
    $assert(have === 0, "have should not go down");
  }

  const afterWrite = handle.afterWrite;
  if (afterWrite) {
    handle.afterWrite = null;
    afterWrite();
  }

  if (self.destroyed) {
    this.cb();
    return;
  }

  // Exhausted the output buffer, or used all the input create a new one.
  let chunkSize: number | undefined;
  if (availOutAfter === 0 || self._outOffset >= (chunkSize = self._chunkSize)) {
    chunkSize ??= self._chunkSize;
    handle.availOutBefore = chunkSize;
    self._outOffset = 0;
    self._outBuffer = Buffer.allocUnsafe(chunkSize);
  }

  if (availOutAfter === 0) {
    // Not actually done. Need to reprocess.
    // Also, update the availInBefore to the availInAfter value,
    // so that if we have to hit it a third (fourth, etc.) time,
    // it'll have the correct byte counts.
    handle.inOff += inDelta;
    handle.availInBefore = availInAfter;

    if (!streamBufferIsFull) {
      this.write(
        handle.flushFlag, // flush
        this.buffer, // in
        handle.inOff, // in_off
        handle.availInBefore, // in_len
        self._outBuffer, // out
        self._outOffset, // out_off
        self._chunkSize, // out_len
      );
    } else {
      const oldRead = self._read;
      // `buffer` is set only while a write is on the threadpool.
      const buffer = this.buffer;
      this.buffer = null;
      self._read = n => {
        self._read = oldRead;
        this.buffer = buffer;
        this.write(
          handle.flushFlag, // flush
          buffer, // in
          handle.inOff, // in_off
          handle.availInBefore, // in_len
          self._outBuffer, // out
          self._outOffset, // out_off
          self._chunkSize, // out_len
        );
        self._read(n);
      };
    }
    return;
  }

  if (availInAfter > 0) {
    // If we have more input that should be written, but we also have output
    // space available, that means that the compression library was not
    // interested in receiving more data, and in particular that the input
    // stream has ended early.
    // This applies to streams where we don't check data past the end of
    // what was consumed; that is, everything except Gunzip/Unzip.

    self.push(null);
  }

  // Finished with the chunk.
  const afterFlush = this.buffer![kAfterFlush];
  this.buffer = null;
  // The handle is idle until this.cb() gives it the next buffered chunk.
  if (afterFlush) afterFlush();
  this.cb();
}

function _close(engine: $Node.ZlibBase) {
  // Caller may invoke .close after a zlib error (which will null _handle)
  engine._handle?.close();
  engine._handle = null;
}

const zlibDefaultOpts = {
  flush: Z_NO_FLUSH,
  finishFlush: Z_FINISH,
  fullFlush: Z_FULL_FLUSH,
};
// Base class for all streams actually backed by zlib and using zlib-specific
// parameters.
function Zlib(this: $Node.Zlib, opts: ZlibOptions | undefined, mode: number) {
  let windowBits = Z_DEFAULT_WINDOWBITS;
  let level = Z_DEFAULT_COMPRESSION;
  let memLevel = Z_DEFAULT_MEMLEVEL;
  let strategy = Z_DEFAULT_STRATEGY;
  let dictionary;

  if (opts) {
    // windowBits is special. On the compression side, 0 is an invalid value.
    // But on the decompression side, a value of 0 for windowBits tells zlib
    // to use the window size in the zlib header of the compressed stream.
    if ((opts.windowBits == null || opts.windowBits === 0) && (mode === INFLATE || mode === GUNZIP || mode === UNZIP)) {
      windowBits = 0;
    } else {
      // `{ windowBits: 8 }` is valid for deflate but not gzip.
      const min = Z_MIN_WINDOWBITS + (mode === GZIP ? 1 : 0);
      windowBits = checkRangesOrGetDefault(
        opts.windowBits,
        "options.windowBits",
        min,
        Z_MAX_WINDOWBITS,
        Z_DEFAULT_WINDOWBITS,
      );
    }

    level = checkRangesOrGetDefault(opts.level, "options.level", Z_MIN_LEVEL, Z_MAX_LEVEL, Z_DEFAULT_COMPRESSION);
    // prettier-ignore
    memLevel = checkRangesOrGetDefault(opts.memLevel, "options.memLevel", Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL, Z_DEFAULT_MEMLEVEL);
    // prettier-ignore
    strategy = checkRangesOrGetDefault(opts.strategy, "options.strategy", Z_DEFAULT_STRATEGY, Z_FIXED, Z_DEFAULT_STRATEGY);

    dictionary = opts.dictionary;
    if (dictionary !== undefined && !isArrayBufferView(dictionary)) {
      if (isAnyArrayBuffer(dictionary)) {
        dictionary = Buffer.from(dictionary) as Buffer;
      } else {
        throw $ERR_INVALID_ARG_TYPE(
          "options.dictionary",
          ["Buffer", "TypedArray", "DataView", "ArrayBuffer"],
          dictionary,
        );
      }
    }
  }

  const handle = new NativeZlib(mode);
  this._writeState = new Uint32Array(2);
  handle.init(windowBits, level, memLevel, strategy, this._writeState, processCallback, dictionary);

  ZlibBase.$apply(this, [opts, mode, handle, zlibDefaultOpts]);

  this._level = level;
  this._strategy = strategy;
}
$toClass(Zlib, "Zlib", ZlibBase);

// This callback is used by `.params()` to wait until a full flush happened before adjusting the parameters.
// In particular, the call to the native `params()` function should not happen while a write is currently in progress on the threadpool.
function paramsAfterFlushCallback(this: $Node.Zlib, level: number, strategy: number, callback?: () => void) {
  if (!this._handle) return;
  this._handle.params(level | 0, strategy | 0);
  if (!this.destroyed) {
    this._level = level;
    this._strategy = strategy;
    if (callback) callback();
  }
}

Zlib.prototype.params = function params(this: $Node.Zlib, level: number, strategy: number, callback: () => void) {
  checkRangesOrGetDefault(level, "level", Z_MIN_LEVEL, Z_MAX_LEVEL);
  checkRangesOrGetDefault(strategy, "strategy", Z_DEFAULT_STRATEGY, Z_FIXED);

  if (this._level !== level || this._strategy !== strategy) {
    if (this.writableEnded) {
      const apply = paramsAfterFlushCallback.bind(this, level, strategy, callback);
      const handle = this._handle;
      if (!this.writableFinished) {
        this.once("end", apply);
      } else if (handle?.buffer) {
        // 'finish' comes while the last chunk is still on the threadpool.
        const afterWrite = handle.afterWrite;
        handle.afterWrite = afterWrite ? () => (afterWrite(), apply()) : apply;
      } else {
        process.nextTick(apply);
      }
    } else {
      // A write callback runs after the next buffered chunk went to the handle, so processCallback() changes the parameters.
      const flush: Buffer & { [kFlushFlag]?: number; [kAfterFlush]?: () => void } = Buffer.alloc(0);
      flush[kFlushFlag] = Z_SYNC_FLUSH;
      flush[kAfterFlush] = paramsAfterFlushCallback.bind(this, level, strategy, undefined);
      this.write(flush, "", callback && (() => this.destroyed || callback()));
    }
  } else {
    process.nextTick(callback);
  }
};

function Deflate(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof Deflate)) return new Deflate(opts) as any;
  Zlib.$apply(this, [opts, DEFLATE]);
}
$toClass(Deflate, "Deflate", Zlib);

function Inflate(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof Inflate)) return new Inflate(opts) as any;
  Zlib.$apply(this, [opts, INFLATE]);
}
$toClass(Inflate, "Inflate", Zlib);

function Gzip(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof Gzip)) return new Gzip(opts) as any;
  Zlib.$apply(this, [opts, GZIP]);
}
$toClass(Gzip, "Gzip", Zlib);

function Gunzip(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof Gunzip)) return new Gunzip(opts) as any;
  Zlib.$apply(this, [opts, GUNZIP]);
}
$toClass(Gunzip, "Gunzip", Zlib);

function DeflateRaw(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (opts && opts.windowBits === 8) opts.windowBits = 9;
  if (!(this instanceof DeflateRaw)) return new DeflateRaw(opts) as any;
  Zlib.$apply(this, [opts, DEFLATERAW]);
}
$toClass(DeflateRaw, "DeflateRaw", Zlib);

function InflateRaw(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof InflateRaw)) return new InflateRaw(opts) as any;
  Zlib.$apply(this, [opts, INFLATERAW]);
}
$toClass(InflateRaw, "InflateRaw", Zlib);

function Unzip(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof Unzip)) return new Unzip(opts) as any;
  Zlib.$apply(this, [opts, UNZIP]);
}
$toClass(Unzip, "Unzip", Zlib);

// The checker does not take a function for a constructor: both kinds are constructed below.
type ZlibFunction = (this: $Node.Zlib, opts?: ZlibOptions) => void;
type ZlibClass = new (opts?: ZlibOptions) => $Node.ZlibBase;

function createConvenienceMethod(ctor: ZlibFunction | ZlibClass, sync: boolean, methodName: string, isZstd?: boolean) {
  if (sync) {
    const fn = function (buffer: ZlibInput, opts?: ZlibOptions) {
      return zlibBufferSync(new (ctor as ZlibClass)(opts), buffer);
    };
    ObjectDefineProperty(fn, "name", { value: methodName });
    return fn;
  } else {
    const fn = function (buffer: ZlibInput, opts: ZlibOptions | ZlibCallback | undefined, callback?: ZlibCallback) {
      if (typeof opts === "function") {
        callback = opts;
        opts = {};
      }
      // For zstd compression, we need to set pledgedSrcSize to the buffer size
      // so that the content size is included in the frame header
      if (isZstd) {
        // Calculate buffer size
        let bufferSize: number;
        if (typeof buffer === "string") {
          bufferSize = Buffer.byteLength(buffer);
        } else if (isArrayBufferView(buffer)) {
          bufferSize = buffer.byteLength;
        } else if (isAnyArrayBuffer(buffer)) {
          bufferSize = buffer.byteLength;
        } else {
          bufferSize = 0;
        }
        // Set pledgedSrcSize if not already set
        if (!opts?.pledgedSrcSize && bufferSize > 0) {
          opts = { ...opts, pledgedSrcSize: bufferSize };
        }
      }
      return zlibBuffer(new (ctor as ZlibClass)(opts), buffer, callback!);
    };
    ObjectDefineProperty(fn, "name", { value: methodName });
    return fn;
  }
}

const kMaxBrotliParam = 9;

const brotliInitParamsArray = new Uint32Array(kMaxBrotliParam + 1);

const brotliDefaultOpts = {
  flush: BROTLI_OPERATION_PROCESS,
  finishFlush: BROTLI_OPERATION_FINISH,
  fullFlush: BROTLI_OPERATION_FLUSH,
};
function Brotli(this: $Node.Zlib, opts: ZlibOptions | undefined, mode: number) {
  $assert(mode === BROTLI_DECODE || mode === BROTLI_ENCODE);

  TypedArrayPrototypeFill.$call(brotliInitParamsArray, -1);
  if (opts?.params) {
    ArrayPrototypeForEach.$call(ObjectKeys(opts.params), origKey => {
      const key = +origKey;
      if (NumberIsNaN(key) || key < 0 || key > kMaxBrotliParam || (brotliInitParamsArray[key] | 0) !== -1) {
        throw $ERR_BROTLI_INVALID_PARAM(origKey);
      }

      const value = opts.params![origKey];
      if (typeof value !== "number" && typeof value !== "boolean") {
        throw $ERR_INVALID_ARG_TYPE("options.params[key]", "number", opts.params![origKey]);
      }
      brotliInitParamsArray[key] = +value;
    });
  }

  let dictionary = opts?.dictionary;
  if (dictionary !== undefined && !isArrayBufferView(dictionary)) {
    if (isAnyArrayBuffer(dictionary)) {
      dictionary = Buffer.from(dictionary) as Buffer;
    } else {
      throw $ERR_INVALID_ARG_TYPE(
        "options.dictionary",
        ["Buffer", "TypedArray", "DataView", "ArrayBuffer"],
        dictionary,
      );
    }
  }

  const handle = new NativeBrotli(mode);

  this._writeState = new Uint32Array(2);
  if (!handle.init(brotliInitParamsArray, this._writeState, processCallback, dictionary)) {
    throw $ERR_ZLIB_INITIALIZATION_FAILED();
  }

  ZlibBase.$apply(this, [opts, mode, handle, brotliDefaultOpts]);
}
$toClass(Brotli, "Brotli", Zlib);
Brotli.prototype[kFlushBound] = FLUSH_BOUND[FLUSH_BOUND_IDX_BROTLI];

function BrotliCompress(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof BrotliCompress)) return new BrotliCompress(opts) as any;
  Brotli.$apply(this, [opts, BROTLI_ENCODE]);
}
$toClass(BrotliCompress, "BrotliCompress", Brotli);

function BrotliDecompress(this: $Node.Zlib, opts?: ZlibOptions): void {
  if (!(this instanceof BrotliDecompress)) return new BrotliDecompress(opts) as any;
  Brotli.$apply(this, [opts, BROTLI_DECODE]);
}
$toClass(BrotliDecompress, "BrotliDecompress", Brotli);

const zstdDefaultOpts = {
  flush: ZSTD_e_continue,
  finishFlush: ZSTD_e_end,
  fullFlush: ZSTD_e_flush,
};

class Zstd extends (ZlibBase as unknown as ZlibBaseConstructor) {
  constructor(opts: ZlibOptions | undefined, mode: number, initParamsArray: Uint32Array, maxParam: number) {
    $assert(mode === ZSTD_COMPRESS || mode === ZSTD_DECOMPRESS);

    initParamsArray.fill(-1);
    if (opts?.params) {
      ObjectKeys(opts.params).forEach(origKey => {
        const key = +origKey;
        if (NumberIsNaN(key) || key < 0 || key > maxParam || (initParamsArray[key] | 0) !== -1) {
          throw $ERR_ZSTD_INVALID_PARAM(origKey);
        }

        const value = opts.params![origKey];
        if (typeof value !== "number" && typeof value !== "boolean") {
          throw $ERR_INVALID_ARG_TYPE("options.params[key]", "number", opts.params![origKey]);
        }
        initParamsArray[key] = value as number;
      });
    }

    const handle = new NativeZstd(mode);

    const pledgedSrcSize = opts?.pledgedSrcSize ?? undefined;

    const writeState = new Uint32Array(2);
    // Node does not validate options.dictionary here (unlike Zlib/Brotli) — a
    // non-view is silently ignored — and re-reads it rather than caching. Both
    // are load-bearing for parity, so this mirrors lib/zlib.js:920 verbatim.
    handle.init(
      initParamsArray,
      pledgedSrcSize,
      writeState,
      processCallback,
      opts?.dictionary && isArrayBufferView(opts.dictionary) ? opts.dictionary : undefined,
    );
    super(opts, mode, handle, zstdDefaultOpts);
    this._writeState = writeState;
  }
}
Zstd.prototype[kFlushBound] = FLUSH_BOUND[FLUSH_BOUND_IDX_ZSTD];

const kMaxZstdCParam = MathMax(...ObjectKeys(constants).map(key => (key.startsWith("ZSTD_c_") ? constants[key] : 0)));

const zstdInitCParamsArray = new Uint32Array(kMaxZstdCParam + 1);

class ZstdCompress extends Zstd {
  constructor(opts?: ZlibOptions) {
    super(opts, ZSTD_COMPRESS, zstdInitCParamsArray, kMaxZstdCParam);
  }
}

const kMaxZstdDParam = MathMax(...ObjectKeys(constants).map(key => (key.startsWith("ZSTD_d_") ? constants[key] : 0)));

const zstdInitDParamsArray = new Uint32Array(kMaxZstdDParam + 1);

class ZstdDecompress extends Zstd {
  constructor(opts?: ZlibOptions) {
    super(opts, ZSTD_DECOMPRESS, zstdInitDParamsArray, kMaxZstdDParam);
  }
}

// Legacy alias on the C++ wrapper object.
ObjectDefineProperty(NativeZlib.prototype, "jsref", {
  __proto__: null,
  get(this: ZlibHandle) {
    return this[owner_symbol];
  },
  set(this: ZlibHandle, v: $Node.ZlibBase) {
    return (this[owner_symbol] = v);
  },
});

const zlib = {
  crc32,
  Deflate,
  Inflate,
  Gzip,
  Gunzip,
  DeflateRaw,
  InflateRaw,
  Unzip,
  BrotliCompress,
  BrotliDecompress,
  ZstdCompress,
  ZstdDecompress,

  deflate: createConvenienceMethod(Deflate, false, "deflate"),
  deflateSync: createConvenienceMethod(Deflate, true, "deflateSync"),
  gzip: createConvenienceMethod(Gzip, false, "gzip"),
  gzipSync: createConvenienceMethod(Gzip, true, "gzipSync"),
  deflateRaw: createConvenienceMethod(DeflateRaw, false, "deflateRaw"),
  deflateRawSync: createConvenienceMethod(DeflateRaw, true, "deflateRawSync"),
  unzip: createConvenienceMethod(Unzip, false, "unzip"),
  unzipSync: createConvenienceMethod(Unzip, true, "unzipSync"),
  inflate: createConvenienceMethod(Inflate, false, "inflate"),
  inflateSync: createConvenienceMethod(Inflate, true, "inflateSync"),
  gunzip: createConvenienceMethod(Gunzip, false, "gunzip"),
  gunzipSync: createConvenienceMethod(Gunzip, true, "gunzipSync"),
  inflateRaw: createConvenienceMethod(InflateRaw, false, "inflateRaw"),
  inflateRawSync: createConvenienceMethod(InflateRaw, true, "inflateRawSync"),
  brotliCompress: createConvenienceMethod(BrotliCompress, false, "brotliCompress"),
  brotliCompressSync: createConvenienceMethod(BrotliCompress, true, "brotliCompressSync"),
  brotliDecompress: createConvenienceMethod(BrotliDecompress, false, "brotliDecompress"),
  brotliDecompressSync: createConvenienceMethod(BrotliDecompress, true, "brotliDecompressSync"),
  zstdCompress: createConvenienceMethod(ZstdCompress, false, "zstdCompress", true),
  zstdCompressSync: createConvenienceMethod(ZstdCompress, true, "zstdCompressSync"),
  zstdDecompress: createConvenienceMethod(ZstdDecompress, false, "zstdDecompress"),
  zstdDecompressSync: createConvenienceMethod(ZstdDecompress, true, "zstdDecompressSync"),

  createDeflate: function (options?: ZlibOptions): $Node.ZlibBase {
    return new Deflate(options);
  },
  createInflate: function (options?: ZlibOptions): $Node.ZlibBase {
    return new Inflate(options);
  },
  createDeflateRaw: function (options?: ZlibOptions): $Node.ZlibBase {
    return new DeflateRaw(options);
  },
  createInflateRaw: function (options?: ZlibOptions): $Node.ZlibBase {
    return new InflateRaw(options);
  },
  createGzip: function (options?: ZlibOptions): $Node.ZlibBase {
    return new Gzip(options);
  },
  createGunzip: function (options?: ZlibOptions): $Node.ZlibBase {
    return new Gunzip(options);
  },
  createUnzip: function (options?: ZlibOptions): $Node.ZlibBase {
    return new Unzip(options);
  },
  createBrotliCompress: function (options?: ZlibOptions): $Node.ZlibBase {
    return new BrotliCompress(options);
  },
  createBrotliDecompress: function (options?: ZlibOptions): $Node.ZlibBase {
    return new BrotliDecompress(options);
  },
  createZstdCompress: function (options?: ZlibOptions): $Node.ZlibBase {
    return new ZstdCompress(options);
  },
  createZstdDecompress: function (options?: ZlibOptions): $Node.ZlibBase {
    return new ZstdDecompress(options);
  },
};

ObjectDefineProperties(zlib, {
  constants: {
    enumerable: true,
    value: ObjectFreeze(constants),
  },
  codes: {
    enumerable: true,
    value: ObjectFreeze(codes),
  },
});

// These should be considered deprecated
// expose all the zlib constants
{
  // prettier-ignore
  const { Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_ERRNO, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR, Z_BUF_ERROR, Z_VERSION_ERROR, Z_NO_COMPRESSION, Z_BEST_SPEED, Z_BEST_COMPRESSION, Z_DEFAULT_COMPRESSION, Z_FILTERED, Z_HUFFMAN_ONLY, Z_RLE, ZLIB_VERNUM, Z_MAX_CHUNK, Z_DEFAULT_LEVEL } = constants;
  ObjectDefineProperty(zlib, "Z_NO_FLUSH", { value: Z_NO_FLUSH });
  ObjectDefineProperty(zlib, "Z_PARTIAL_FLUSH", { value: Z_PARTIAL_FLUSH });
  ObjectDefineProperty(zlib, "Z_SYNC_FLUSH", { value: Z_SYNC_FLUSH });
  ObjectDefineProperty(zlib, "Z_FULL_FLUSH", { value: Z_FULL_FLUSH });
  ObjectDefineProperty(zlib, "Z_FINISH", { value: Z_FINISH });
  ObjectDefineProperty(zlib, "Z_BLOCK", { value: Z_BLOCK });
  ObjectDefineProperty(zlib, "Z_OK", { value: Z_OK });
  ObjectDefineProperty(zlib, "Z_STREAM_END", { value: Z_STREAM_END });
  ObjectDefineProperty(zlib, "Z_NEED_DICT", { value: Z_NEED_DICT });
  ObjectDefineProperty(zlib, "Z_ERRNO", { value: Z_ERRNO });
  ObjectDefineProperty(zlib, "Z_STREAM_ERROR", { value: Z_STREAM_ERROR });
  ObjectDefineProperty(zlib, "Z_DATA_ERROR", { value: Z_DATA_ERROR });
  ObjectDefineProperty(zlib, "Z_MEM_ERROR", { value: Z_MEM_ERROR });
  ObjectDefineProperty(zlib, "Z_BUF_ERROR", { value: Z_BUF_ERROR });
  ObjectDefineProperty(zlib, "Z_VERSION_ERROR", { value: Z_VERSION_ERROR });
  ObjectDefineProperty(zlib, "Z_NO_COMPRESSION", { value: Z_NO_COMPRESSION });
  ObjectDefineProperty(zlib, "Z_BEST_SPEED", { value: Z_BEST_SPEED });
  ObjectDefineProperty(zlib, "Z_BEST_COMPRESSION", { value: Z_BEST_COMPRESSION });
  ObjectDefineProperty(zlib, "Z_DEFAULT_COMPRESSION", { value: Z_DEFAULT_COMPRESSION });
  ObjectDefineProperty(zlib, "Z_FILTERED", { value: Z_FILTERED });
  ObjectDefineProperty(zlib, "Z_HUFFMAN_ONLY", { value: Z_HUFFMAN_ONLY });
  ObjectDefineProperty(zlib, "Z_RLE", { value: Z_RLE });
  ObjectDefineProperty(zlib, "Z_FIXED", { value: Z_FIXED });
  ObjectDefineProperty(zlib, "Z_DEFAULT_STRATEGY", { value: Z_DEFAULT_STRATEGY });
  ObjectDefineProperty(zlib, "ZLIB_VERNUM", { value: ZLIB_VERNUM });
  ObjectDefineProperty(zlib, "DEFLATE", { value: DEFLATE });
  ObjectDefineProperty(zlib, "INFLATE", { value: INFLATE });
  ObjectDefineProperty(zlib, "GZIP", { value: GZIP });
  ObjectDefineProperty(zlib, "GUNZIP", { value: GUNZIP });
  ObjectDefineProperty(zlib, "DEFLATERAW", { value: DEFLATERAW });
  ObjectDefineProperty(zlib, "INFLATERAW", { value: INFLATERAW });
  ObjectDefineProperty(zlib, "UNZIP", { value: UNZIP });
  ObjectDefineProperty(zlib, "Z_MIN_WINDOWBITS", { value: Z_MIN_WINDOWBITS });
  ObjectDefineProperty(zlib, "Z_MAX_WINDOWBITS", { value: Z_MAX_WINDOWBITS });
  ObjectDefineProperty(zlib, "Z_DEFAULT_WINDOWBITS", { value: Z_DEFAULT_WINDOWBITS });
  ObjectDefineProperty(zlib, "Z_MIN_CHUNK", { value: Z_MIN_CHUNK });
  ObjectDefineProperty(zlib, "Z_MAX_CHUNK", { value: Z_MAX_CHUNK });
  ObjectDefineProperty(zlib, "Z_DEFAULT_CHUNK", { value: Z_DEFAULT_CHUNK });
  ObjectDefineProperty(zlib, "Z_MIN_MEMLEVEL", { value: Z_MIN_MEMLEVEL });
  ObjectDefineProperty(zlib, "Z_MAX_MEMLEVEL", { value: Z_MAX_MEMLEVEL });
  ObjectDefineProperty(zlib, "Z_DEFAULT_MEMLEVEL", { value: Z_DEFAULT_MEMLEVEL });
  ObjectDefineProperty(zlib, "Z_MIN_LEVEL", { value: Z_MIN_LEVEL });
  ObjectDefineProperty(zlib, "Z_MAX_LEVEL", { value: Z_MAX_LEVEL });
  ObjectDefineProperty(zlib, "Z_DEFAULT_LEVEL", { value: Z_DEFAULT_LEVEL });
}

export default zlib;
