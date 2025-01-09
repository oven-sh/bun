// Hardcoded module "node:zlib"

const assert = require("node:assert");
const BufferModule = require("node:buffer");

const crc32 = $newZigFunction("node_zlib_binding.zig", "crc32", 1);
const NativeZlib = $zig("node_zlib_binding.zig", "NativeZlib");
const NativeBrotli = $zig("node_zlib_binding.zig", "NativeBrotli");

const ObjectKeys = Object.keys;
const ArrayPrototypePush = Array.prototype.push;
const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectFreeze = Object.freeze;
const StringPrototypeStartsWith = String.prototype.startsWith;
const MathMax = Math.max;
const ArrayPrototypeMap = Array.prototype.map;
const TypedArrayPrototypeFill = Uint8Array.prototype.fill;
const ArrayPrototypeForEach = Array.prototype.forEach;
const NumberIsNaN = Number.isNaN;

const ArrayBufferIsView = ArrayBuffer.isView;
const isArrayBufferView = ArrayBufferIsView;
const isAnyArrayBuffer = b => b instanceof ArrayBuffer || b instanceof SharedArrayBuffer;
const kMaxLength = $requireMap.$get("buffer")?.exports.kMaxLength ?? BufferModule.kMaxLength;

const { ERR_BROTLI_INVALID_PARAM, ERR_BUFFER_TOO_LARGE, ERR_OUT_OF_RANGE } = require("internal/errors");
const { Transform, finished } = require("node:stream");
const owner_symbol = Symbol("owner_symbol");
const {
  checkRangesOrGetDefault,
  validateFunction,
  validateUint32,
  validateFiniteNumber,
} = require("internal/validators");

const kFlushFlag = Symbol("kFlushFlag");
const kError = Symbol("kError");

const { zlib: constants } = process.binding("constants");
// prettier-ignore
const {
  // Zlib flush levels
  Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH,
  // Zlib option values
  Z_MIN_CHUNK, Z_MIN_WINDOWBITS, Z_MAX_WINDOWBITS, Z_MIN_LEVEL, Z_MAX_LEVEL, Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL,
  Z_DEFAULT_CHUNK, Z_DEFAULT_COMPRESSION, Z_DEFAULT_STRATEGY, Z_DEFAULT_WINDOWBITS, Z_DEFAULT_MEMLEVEL, Z_FIXED,
  // Node's compression stream modes (node_zlib_mode)
  DEFLATE, DEFLATERAW, INFLATE, INFLATERAW, GZIP, GUNZIP, UNZIP, BROTLI_DECODE, BROTLI_ENCODE,
  // Brotli operations (~flush levels)
  BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_FLUSH, BROTLI_OPERATION_FINISH, BROTLI_OPERATION_EMIT_METADATA,
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

function zlibBuffer(engine, buffer, callback) {
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

function zlibBufferOnData(chunk) {
  if (!this.buffers) this.buffers = [chunk];
  else ArrayPrototypePush.$call(this.buffers, chunk);
  this.nread += chunk.length;
  if (this.nread > this._maxOutputLength) {
    this.close();
    this.removeAllListeners("end");
    this.cb(ERR_BUFFER_TOO_LARGE(this._maxOutputLength));
  }
}

function zlibBufferOnError(err) {
  this.removeAllListeners("end");
  this.cb(err);
}

function zlibBufferOnEnd() {
  let buf;
  if (this.nread === 0) {
    buf = Buffer.alloc(0);
  } else {
    const bufs = this.buffers;
    buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs, this.nread);
  }
  this.close();
  if (this._info) this.cb(null, { buffer: buf, engine: this });
  else this.cb(null, buf);
}

function zlibBufferSync(engine, buffer) {
  if (typeof buffer === "string") {
    buffer = Buffer.from(buffer);
  } else if (!isArrayBufferView(buffer)) {
    if (isAnyArrayBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    } else {
      throw $ERR_INVALID_ARG_TYPE("buffer", "string, Buffer, TypedArray, DataView, or ArrayBuffer", buffer);
    }
  }
  buffer = processChunkSync(engine, buffer, engine._finishFlushFlag);
  if (engine._info) return { buffer, engine };
  return buffer;
}

function zlibOnError(message, errno, code) {
  const self = this[owner_symbol];
  // There is no way to cleanly recover. Continuing only obscures problems.
  const error = new Error(message);
  error.errno = errno;
  error.code = code;
  self.destroy(error);
  self[kError] = error;
}

const FLUSH_BOUND = [
  [Z_NO_FLUSH, Z_BLOCK],
  [BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_EMIT_METADATA],
];
const FLUSH_BOUND_IDX_NORMAL = 0;
const FLUSH_BOUND_IDX_BROTLI = 1;

// The base class for all Zlib-style streams.
function ZlibBase(opts, mode, handle, { flush, finishFlush, fullFlush }) {
  let chunkSize = Z_DEFAULT_CHUNK;
  let maxOutputLength = kMaxLength;
  // The ZlibBase class is not exported to user land, the mode should only be passed in by us.
  assert(typeof mode === "number");
  assert(mode >= DEFLATE && mode <= BROTLI_ENCODE);

  let flushBoundIdx;
  if (mode !== BROTLI_ENCODE && mode !== BROTLI_DECODE) {
    flushBoundIdx = FLUSH_BOUND_IDX_NORMAL;
  } else {
    flushBoundIdx = FLUSH_BOUND_IDX_BROTLI;
  }

  if (opts) {
    chunkSize = opts.chunkSize;
    if (!validateFiniteNumber(chunkSize, "options.chunkSize")) {
      chunkSize = Z_DEFAULT_CHUNK;
    } else if (chunkSize < Z_MIN_CHUNK) {
      throw ERR_OUT_OF_RANGE("options.chunkSize", `>= ${Z_MIN_CHUNK}`, chunkSize);
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

  Transform.$apply(this, [{ autoDestroy: true, ...opts }]);
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

ObjectDefineProperty(ZlibBase.prototype, "_closed", {
  configurable: true,
  enumerable: true,
  get() {
    return !this._handle;
  },
});

// `bytesRead` made sense as a name when looking from the zlib engine's
// perspective, but it is inconsistent with all other streams exposed by Node.js
// that have this concept, where it stands for the number of bytes read
// *from* the stream (that is, net.Socket/tls.Socket & file system streams).
ObjectDefineProperty(ZlibBase.prototype, "bytesRead", {
  configurable: true,
  get: function () {
    return this.bytesWritten;
  },
  set: function (value) {
    this.bytesWritten = value;
  },
});

ZlibBase.prototype.reset = function () {
  assert(this._handle, "zlib binding closed");
  return this._handle.reset();
};

// This is the _flush function called by the transform class, internally, when the last chunk has been written.
ZlibBase.prototype._flush = function (callback) {
  this._transform(Buffer.alloc(0), "", callback);
};

// Force Transform compat behavior.
ZlibBase.prototype._final = function (callback) {
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

function maxFlush(a, b) {
  return flushiness[a] > flushiness[b] ? a : b;
}

// Set up a list of 'special' buffers that can be written using .write()
// from the .flush() code as a way of introducing flushing operations into the
// write sequence.
const kFlushBuffers: (typeof Buffer)[] = [];
{
  const dummyArrayBuffer = new ArrayBuffer();
  for (const flushFlag of kFlushFlagList) {
    kFlushBuffers[flushFlag] = Buffer.from(dummyArrayBuffer);
    kFlushBuffers[flushFlag][kFlushFlag] = flushFlag;
  }
}

ZlibBase.prototype.flush = function (kind, callback) {
  if (typeof kind === "function" || (kind === undefined && !callback)) {
    callback = kind;
    kind = this._defaultFullFlushFlag;
  }
  if (this.writableFinished) {
    if (callback) process.nextTick(callback);
  } else if (this.writableEnded) {
    if (callback) this.once("end", callback);
  } else {
    this.write(kFlushBuffers[kind], "", callback);
  }
};

ZlibBase.prototype.close = function (callback) {
  if (callback) finished(this, callback);
  this.destroy();
};

ZlibBase.prototype._destroy = function (err, callback) {
  _close(this);
  callback(err);
};

ZlibBase.prototype._transform = function (chunk, encoding, cb) {
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

ZlibBase.prototype._processChunk = function (chunk, flushFlag, cb) {
  // _processChunk() is left for backwards compatibility
  if (typeof cb === "function") processChunk(this, chunk, flushFlag, cb);
  else return processChunkSync(this, chunk, flushFlag);
};

function processChunkSync(self, chunk, flushFlag) {
  let availInBefore = chunk.byteLength;
  let availOutBefore = self._chunkSize - self._outOffset;
  let inOff = 0;
  let availOutAfter;
  let availInAfter;

  const buffers = [];
  let nread = 0;
  let inputRead = 0;
  const state = self._writeState;
  const handle = self._handle;
  let buffer = self._outBuffer;
  let offset = self._outOffset;
  const chunkSize = self._chunkSize;

  let error;
  self.on("error", function onError(er) {
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
    if (error) throw error;
    else if (self[kError]) throw self[kError];

    availOutAfter = state[0];
    availInAfter = state[1];

    const inDelta = availInBefore - availInAfter;
    inputRead += inDelta;

    const have = availOutBefore - availOutAfter;
    if (have > 0) {
      const out = buffer.slice(offset, offset + have);
      offset += have;
      ArrayPrototypePush.$call(buffers, out);
      nread += out.byteLength;

      if (nread > self._maxOutputLength) {
        _close(self);
        throw ERR_BUFFER_TOO_LARGE(self._maxOutputLength);
      }
    } else {
      assert(have === 0, "have should not go down");
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

function processChunk(self, chunk, flushFlag, cb) {
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

function processCallback() {
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
    const out = self._outBuffer.slice(self._outOffset, self._outOffset + have);
    self._outOffset += have;
    streamBufferIsFull = !self.push(out);
  } else {
    assert(have === 0, "have should not go down");
  }

  if (self.destroyed) {
    this.cb();
    return;
  }

  // Exhausted the output buffer, or used all the input create a new one.
  if (availOutAfter === 0 || self._outOffset >= self._chunkSize) {
    handle.availOutBefore = self._chunkSize;
    self._outOffset = 0;
    self._outBuffer = Buffer.allocUnsafe(self._chunkSize);
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
      self._read = n => {
        self._read = oldRead;
        this.write(
          handle.flushFlag, // flush
          this.buffer, // in
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
  this.buffer = null;
  this.cb();
}

function _close(engine) {
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
function Zlib(opts, mode) {
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
        dictionary = Buffer.from(dictionary);
      } else {
        throw $ERR_INVALID_ARG_TYPE("options.dictionary", "Buffer, TypedArray, DataView, or ArrayBuffer", dictionary);
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
function paramsAfterFlushCallback(level, strategy, callback) {
  assert(this._handle, "zlib binding closed");
  this._handle.params(level, strategy);
  if (!this.destroyed) {
    this._level = level;
    this._strategy = strategy;
    if (callback) callback();
  }
}

Zlib.prototype.params = function params(level, strategy, callback) {
  checkRangesOrGetDefault(level, "level", Z_MIN_LEVEL, Z_MAX_LEVEL);
  checkRangesOrGetDefault(strategy, "strategy", Z_DEFAULT_STRATEGY, Z_FIXED);

  if (this._level !== level || this._strategy !== strategy) {
    this.flush(Z_SYNC_FLUSH, paramsAfterFlushCallback.bind(this, level, strategy, callback));
  } else {
    process.nextTick(callback);
  }
};

function Deflate(opts) {
  if (!(this instanceof Deflate)) return new Deflate(opts);
  Zlib.$apply(this, [opts, DEFLATE]);
}
$toClass(Deflate, "Deflate", Zlib);

function Inflate(opts) {
  if (!(this instanceof Inflate)) return new Inflate(opts);
  Zlib.$apply(this, [opts, INFLATE]);
}
$toClass(Inflate, "Inflate", Zlib);

function Gzip(opts) {
  if (!(this instanceof Gzip)) return new Gzip(opts);
  Zlib.$apply(this, [opts, GZIP]);
}
$toClass(Gzip, "Gzip", Zlib);

function Gunzip(opts) {
  if (!(this instanceof Gunzip)) return new Gunzip(opts);
  Zlib.$apply(this, [opts, GUNZIP]);
}
$toClass(Gunzip, "Gunzip", Zlib);

function DeflateRaw(opts) {
  if (opts && opts.windowBits === 8) opts.windowBits = 9;
  if (!(this instanceof DeflateRaw)) return new DeflateRaw(opts);
  Zlib.$apply(this, [opts, DEFLATERAW]);
}
$toClass(DeflateRaw, "DeflateRaw", Zlib);

function InflateRaw(opts) {
  if (!(this instanceof InflateRaw)) return new InflateRaw(opts);
  Zlib.$apply(this, [opts, INFLATERAW]);
}
$toClass(InflateRaw, "InflateRaw", Zlib);

function Unzip(opts) {
  if (!(this instanceof Unzip)) return new Unzip(opts);
  Zlib.$apply(this, [opts, UNZIP]);
}
$toClass(Unzip, "Unzip", Zlib);

function createConvenienceMethod(ctor, sync, methodName) {
  if (sync) {
    const fn = function (buffer, opts) {
      return zlibBufferSync(new ctor(opts), buffer);
    };
    ObjectDefineProperty(fn, "name", { value: methodName });
    return fn;
  } else {
    const fn = function (buffer, opts, callback) {
      if (typeof opts === "function") {
        callback = opts;
        opts = {};
      }
      return zlibBuffer(new ctor(opts), buffer, callback);
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
function Brotli(opts, mode) {
  assert(mode === BROTLI_DECODE || mode === BROTLI_ENCODE);

  TypedArrayPrototypeFill.$call(brotliInitParamsArray, -1);
  if (opts?.params) {
    ArrayPrototypeForEach.$call(ObjectKeys(opts.params), origKey => {
      const key = +origKey;
      if (NumberIsNaN(key) || key < 0 || key > kMaxBrotliParam || (brotliInitParamsArray[key] | 0) !== -1) {
        throw ERR_BROTLI_INVALID_PARAM(origKey);
      }

      const value = opts.params[origKey];
      if (typeof value !== "number" && typeof value !== "boolean") {
        throw $ERR_INVALID_ARG_TYPE("options.params[key]", "number", opts.params[origKey]);
      }
      brotliInitParamsArray[key] = value;
    });
  }

  const handle = new NativeBrotli(mode);

  this._writeState = new Uint32Array(2);
  if (!handle.init(brotliInitParamsArray, this._writeState, processCallback)) {
    throw $ERR_ZLIB_INITIALIZATION_FAILED();
  }

  ZlibBase.$apply(this, [opts, mode, handle, brotliDefaultOpts]);
}
$toClass(Brotli, "Brotli", Zlib);

function BrotliCompress(opts) {
  if (!(this instanceof BrotliCompress)) return new BrotliCompress(opts);
  Brotli.$apply(this, [opts, BROTLI_ENCODE]);
}
$toClass(BrotliCompress, "BrotliCompress", Brotli);

function BrotliDecompress(opts) {
  if (!(this instanceof BrotliDecompress)) return new BrotliDecompress(opts);
  Brotli.$apply(this, [opts, BROTLI_DECODE]);
}
$toClass(BrotliDecompress, "BrotliDecompress", Brotli);

// Legacy alias on the C++ wrapper object.
ObjectDefineProperty(NativeZlib.prototype, "jsref", {
  __proto__: null,
  get() {
    return this[owner_symbol];
  },
  set(v) {
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

  createDeflate: function (options) {
    return new Deflate(options);
  },
  createInflate: function (options) {
    return new Inflate(options);
  },
  createDeflateRaw: function (options) {
    return new DeflateRaw(options);
  },
  createInflateRaw: function (options) {
    return new InflateRaw(options);
  },
  createGzip: function (options) {
    return new Gzip(options);
  },
  createGunzip: function (options) {
    return new Gunzip(options);
  },
  createUnzip: function (options) {
    return new Unzip(options);
  },
  createBrotliCompress: function (options) {
    return new BrotliCompress(options);
  },
  createBrotliDecompress: function (options) {
    return new BrotliDecompress(options);
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
