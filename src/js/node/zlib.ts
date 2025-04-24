// Hardcoded module "node:zlib"
import type { ZlibOptions, BrotliOptions } from "node:zlib";
import type { Transform, TransformOptions, TransformCallback } from "node:stream";
import type { Buffer as BufferType } from "node:buffer"; // Use alias to avoid conflict

// Define assert with the correct signature to satisfy TS2775
const assert: (value: any, message?: string | Error) => asserts value = require("node:assert");
const BufferModule = require("node:buffer");
const Buffer = BufferModule.Buffer as BufferConstructor;

const crc32 = $newZigFunction("node_zlib_binding.zig", "crc32", 1);
const NativeZlib = $zig("node_zlib_binding.zig", "NativeZlib") as $ZigGeneratedClasses.NativeZlibConstructor;
const NativeBrotli = $zig("node_zlib_binding.zig", "NativeBrotli") as $ZigGeneratedClasses.NativeBrotliConstructor;

const ObjectKeys = Object.keys;
const ArrayPrototypePush = Array.prototype.push;
const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectFreeze = Object.freeze;
const TypedArrayPrototypeFill = Uint8Array.prototype.fill;
const ArrayPrototypeForEach = Array.prototype.forEach;
const NumberIsNaN = Number.isNaN;

const ArrayBufferIsView = ArrayBuffer.isView;
const isArrayBufferView = ArrayBufferIsView;
const isAnyArrayBuffer = (b: any): b is ArrayBuffer | SharedArrayBuffer =>
  b instanceof ArrayBuffer || b instanceof SharedArrayBuffer;
const kMaxLength = $requireMap.$get("buffer")?.exports.kMaxLength ?? BufferModule.kMaxLength;

const { Transform: TransformImpl, finished } = require("node:stream");
const owner_symbol = Symbol("owner_symbol");
const { checkRangesOrGetDefault, validateFunction, validateFiniteNumber } = require("internal/validators");

const kFlushFlag = Symbol("kFlushFlag");
const kError = Symbol("kError");

const { zlib: constants } = $processBindingConstants;
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
const codes: Record<string | number, string | number> = {
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

type ZlibCallback = (err: Error | null, result?: BufferType | { buffer: BufferType; engine: ZlibBase }) => void;

function zlibBuffer(engine: ZlibBase, buffer: string | BufferType | ArrayBuffer | ArrayBufferView, callback: ZlibCallback) {
  validateFunction(callback, "callback");
  let finalBuffer: BufferType;

  if (typeof buffer === "string") {
    finalBuffer = Buffer.from(buffer);
  } else if (Buffer.isBuffer(buffer)) {
    finalBuffer = buffer;
  } else if (isArrayBufferView(buffer)) {
    // Convert non-Buffer ArrayBufferView to Buffer without copying
    const view = buffer as ArrayBufferView;
    finalBuffer = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  } else if (isAnyArrayBuffer(buffer)) {
    finalBuffer = Buffer.from(buffer);
  } else {
    throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView", "ArrayBuffer"], buffer);
  }

  engine.buffers = undefined;
  engine.nread = 0;
  engine.cb = callback;
  engine.on("data", zlibBufferOnData);
  engine.on("error", zlibBufferOnError);
  engine.on("end", zlibBufferOnEnd);
  engine.end(finalBuffer);
}

function zlibBufferOnData(this: ZlibBase, chunk: BufferType) {
  if (!this.buffers) this.buffers = [chunk];
  else ArrayPrototypePush.$call(this.buffers, chunk);
  this.nread += chunk.length;
  if (this.nread > this._maxOutputLength) {
    this.close();
    this.removeAllListeners("end");
    this.cb($ERR_BUFFER_TOO_LARGE(this._maxOutputLength));
  }
}

function zlibBufferOnError(this: ZlibBase, err: Error) {
  this.removeAllListeners("end");
  this.cb(err);
}

function zlibBufferOnEnd(this: ZlibBase) {
  let buf: BufferType;
  const bufs = this.buffers;
  if (this.nread === 0 || !bufs) {
    buf = Buffer.alloc(0);
  } else {
    buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs!, this.nread);
  }
  // Assuming this.close() takes 0 arguments based on the implementation calling _close
  _close(this);
  if (this._info) this.cb(null, { buffer: buf, engine: this });
  else this.cb(null, buf);
}

function zlibBufferSync(engine: ZlibBase, buffer: string | BufferType | ArrayBuffer | ArrayBufferView): BufferType | { buffer: BufferType; engine: ZlibBase } {
  let finalBuffer: BufferType;
  if (typeof buffer === "string") {
    finalBuffer = Buffer.from(buffer);
  } else if (Buffer.isBuffer(buffer)) {
    finalBuffer = buffer;
  } else if (isArrayBufferView(buffer)) {
    // Convert non-Buffer ArrayBufferView to Buffer without copying
    const view = buffer as ArrayBufferView;
    finalBuffer = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  } else if (isAnyArrayBuffer(buffer)) {
    finalBuffer = Buffer.from(buffer);
  } else {
    throw $ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView", "ArrayBuffer"], buffer);
  }

  const result: BufferType = processChunkSync(engine, finalBuffer, engine._finishFlushFlag);
  if (engine._info) return { buffer: result as BufferType, engine };
  return result as BufferType;
}

// Define a type for the handle with dynamic properties
type ZlibHandle = ($ZigGeneratedClasses.NativeZlib | $ZigGeneratedClasses.NativeBrotli) & {
  buffer?: BufferType | null | undefined;
  cb?: ((error?: Error | null) => void) | ZlibCallback | null | undefined; // Allow TransformCallback too
  availOutBefore?: number;
  availInBefore?: number;
  inOff?: number;
  flushFlag?: number;
  [owner_symbol]?: ZlibBase;
  onerror?: (message: string, errno: number, code: string) => void;
  // Assuming write and writeSync are defined correctly in the .d.ts now
  write?: (
    flush: number,
    inBuf: BufferType,
    inOff: number,
    inLen: number,
    outBuf: BufferType,
    outOff: number,
    outLen: number,
  ) => unknown;
  writeSync?: (
    flush: number,
    inBuf: BufferType,
    inOff: number,
    inLen: number,
    outBuf: BufferType,
    outOff: number,
    outLen: number,
  ) => unknown;
  // Assuming reset and close are defined correctly in the .d.ts now
  reset?: () => unknown;
  close?: () => unknown;
  params?: (level: number, strategy: number) => unknown;
  init?: (...args: any[]) => unknown;
};

function zlibOnError(this: ZlibHandle, message: string, errno: number, code: string) {
  const self = this[owner_symbol];
  if (!self) return; // Should not happen if setup correctly

  // There is no way to cleanly recover. Continuing only obscures problems.
  const error = new Error(message);
  (error as any).errno = errno;
  error.code = code;
  self[kError] = error; // Store error before destroy to avoid race conditions
  self.destroy(error);
}

const FLUSH_BOUND = [
  [Z_NO_FLUSH, Z_BLOCK],
  [BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_EMIT_METADATA],
];
const FLUSH_BOUND_IDX_NORMAL = 0;
const FLUSH_BOUND_IDX_BROTLI = 1;

// Define the interface for ZlibBase, extending Transform
interface ZlibBase extends Transform {
  [kError]: Error | null;
  bytesWritten: number;
  _handle: ZlibHandle | null; // Use the refined ZlibHandle type
  _outBuffer: BufferType;
  _outOffset: number;
  _chunkSize: number;
  _defaultFlushFlag: number;
  _finishFlushFlag: number;
  _defaultFullFlushFlag: number;
  _info?: boolean;
  _maxOutputLength: number;
  _writeState?: Uint32Array; // Keep optional as it's initialized later

  // Properties for zlibBuffer
  buffers: BufferType[] | undefined;
  nread: number;
  cb: ZlibCallback;

  // Methods from Transform + Zlib specific
  reset(): boolean;
  flush(kind?: number | (() => void), callback?: () => void): void;
  close(callback?: () => void): void;
  _processChunk(chunk: BufferType, flushFlag: number, cb?: (error?: Error | null) => void): BufferType | undefined;
  params?(level: number, strategy: number, callback: () => void): void; // Only on Zlib
  _level?: number; // Only on Zlib
  _strategy?: number; // Only on Zlib

  // Explicitly declare methods/properties from Transform that are used
  // Properties
  destroyed: boolean;
  writableEnded: boolean;
  writableLength: number;
  writableFinished: boolean;
  // Methods
  push(chunk: any, encoding?: BufferEncoding): boolean;
  destroy(error?: Error): this;
  // Fix end signature to match Transform
  end(cb?: () => void): this;
  end(chunk: any, cb?: () => void): this;
  end(chunk: any, encoding?: BufferEncoding, cb?: () => void): this;
  _read(size: number): void;
  _destroy(err: Error | null, callback: (error: Error | null) => void): void;
  _transform(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null, data?: any) => void): void;
  _flush(callback: (error?: Error | null, data?: any) => void): void;
  _final(callback: (error?: Error | null) => void): void;
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;
  once(eventName: string | symbol, listener: (...args: any[]) => void): this;
  emit(eventName: string | symbol, ...args: any[]): boolean;
  removeAllListeners(event?: string | symbol): this;
  removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
}

// The base class for all Zlib-style streams.
function ZlibBase(
  this: ZlibBase,
  opts: (ZlibOptions | BrotliOptions | TransformOptions) & { info?: boolean; maxOutputLength?: number } | undefined,
  mode: number,
  handle: $ZigGeneratedClasses.NativeZlib | $ZigGeneratedClasses.NativeBrotli,
  { flush, finishFlush, fullFlush }: { flush: number; finishFlush: number; fullFlush: number },
) {
  let chunkSize = Z_DEFAULT_CHUNK;
  let maxOutputLength = kMaxLength;
  // The ZlibBase class is not exported to user land, the mode should only be passed in by us.
  assert(typeof mode === "number");
  assert(mode >= DEFLATE && mode <= BROTLI_ENCODE);

  let flushBoundIdx: number;
  if (mode !== BROTLI_ENCODE && mode !== BROTLI_DECODE) {
    flushBoundIdx = FLUSH_BOUND_IDX_NORMAL;
  } else {
    flushBoundIdx = FLUSH_BOUND_IDX_BROTLI;
  }

  const transformOpts: TransformOptions = { autoDestroy: true };
  const anyOpts = opts as any; // Use 'any' for easier property access

  if (opts) {
    // Use type assertions for options specific to Zlib/Brotli or Transform
    const zlibBrotliOpts = opts as ZlibOptions | BrotliOptions;

    chunkSize = zlibBrotliOpts.chunkSize!;
    if (!validateFiniteNumber(chunkSize, "options.chunkSize")) {
      chunkSize = Z_DEFAULT_CHUNK;
    } else if (chunkSize < Z_MIN_CHUNK) {
      throw $ERR_OUT_OF_RANGE("options.chunkSize", `>= ${Z_MIN_CHUNK}`, chunkSize);
    }

    // prettier-ignore
    flush = checkRangesOrGetDefault(zlibBrotliOpts.flush, "options.flush", FLUSH_BOUND[flushBoundIdx][0], FLUSH_BOUND[flushBoundIdx][1], flush);
    // prettier-ignore
    finishFlush = checkRangesOrGetDefault(zlibBrotliOpts.finishFlush, "options.finishFlush", FLUSH_BOUND[flushBoundIdx][0], FLUSH_BOUND[flushBoundIdx][1], finishFlush);
    // prettier-ignore
    maxOutputLength = checkRangesOrGetDefault(opts.maxOutputLength, "options.maxOutputLength", 1, kMaxLength, kMaxLength);

    // Pick known TransformOptions properties from opts
    if (anyOpts.readableHighWaterMark !== undefined) transformOpts.readableHighWaterMark = anyOpts.readableHighWaterMark;
    if (anyOpts.writableHighWaterMark !== undefined) transformOpts.writableHighWaterMark = anyOpts.writableHighWaterMark;
    if (anyOpts.readableObjectMode !== undefined) transformOpts.readableObjectMode = anyOpts.readableObjectMode;
    if (anyOpts.writableObjectMode !== undefined) transformOpts.writableObjectMode = anyOpts.writableObjectMode;
    if (anyOpts.objectMode !== undefined) transformOpts.objectMode = anyOpts.objectMode;
    if (anyOpts.decodeStrings !== undefined) transformOpts.decodeStrings = anyOpts.decodeStrings;
    if (anyOpts.encoding !== undefined) transformOpts.encoding = anyOpts.encoding;
    // autoDestroy is already set
    if (anyOpts.emitClose !== undefined) transformOpts.emitClose = anyOpts.emitClose;
    if (anyOpts.highWaterMark !== undefined) transformOpts.highWaterMark = anyOpts.highWaterMark;
    if (anyOpts.signal !== undefined) transformOpts.signal = anyOpts.signal;
    // Methods like destroy, read, write, etc., are usually not passed in options object
  }

  TransformImpl.call(this, transformOpts);
  this[kError] = null;
  this.bytesWritten = 0;
  this._handle = handle as ZlibHandle; // Cast to the refined type
  this._handle[owner_symbol] = this;
  this._handle.onerror = zlibOnError;

  this._outBuffer = Buffer.allocUnsafe(chunkSize);
  this._outOffset = 0;

  this._chunkSize = chunkSize;
  this._defaultFlushFlag = flush;
  this._finishFlushFlag = finishFlush;
  this._defaultFullFlushFlag = fullFlush;
  this._info = opts && opts.info;
  this._maxOutputLength = maxOutputLength;
}
$toClass(ZlibBase, "ZlibBase", TransformImpl);

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
  // Explicit cast to potentially resolve overload issues
  const handle = this._handle as ($ZigGeneratedClasses.NativeZlib | $ZigGeneratedClasses.NativeBrotli);
  return handle.reset!();
};

// This is the _flush function called by the transform class, internally, when the last chunk has been written.
ZlibBase.prototype._flush = function (callback: TransformCallback) {
  this._transform(Buffer.alloc(0), "buffer", callback); // Pass encoding
};

// Force Transform compat behavior.
ZlibBase.prototype._final = function (callback: (error?: Error | null) => void) {
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

function maxFlush(a: number, b: number): number {
  return flushiness[a] > flushiness[b] ? a : b;
}

// Set up a list of 'special' buffers that can be written using .write()
// from the .flush() code as a way of introducing flushing operations into the
// write sequence.
const kFlushBuffers: BufferType[] = [];
{
  const dummyArrayBuffer = new ArrayBuffer(0);
  for (const flushFlag of kFlushFlagList) {
    const buf = Buffer.from(dummyArrayBuffer);
    (buf as any)[kFlushFlag] = flushFlag;
    kFlushBuffers[flushFlag] = buf;
  }
}

ZlibBase.prototype.flush = function (kind?: number | (() => void), callback?: () => void) {
  let flushKind: number;
  if (typeof kind === "function" || (kind === undefined && !callback)) {
    callback = kind as () => void;
    flushKind = this._defaultFullFlushFlag;
  } else if (typeof kind !== "number") {
    flushKind = this._defaultFullFlushFlag;
  } else {
    flushKind = kind;
  }

  if (this.writableFinished) {
    if (callback) process.nextTick(callback);
  } else if (this.writableEnded) {
    if (callback) this.once("end", callback);
  } else {
    // Pass undefined as encoding, required by Transform.write
    this.write(kFlushBuffers[flushKind], undefined, callback);
  }
};

ZlibBase.prototype.close = function (callback?: () => void) {
  if (callback) finished(this, callback);
  this.destroy();
};

function _close(engine: ZlibBase) {
  // Caller may invoke .close after a zlib error (which will null _handle)
  if (engine._handle) {
    // Explicit cast to potentially resolve overload issues
    const handle = engine._handle as ($ZigGeneratedClasses.NativeZlib | $ZigGeneratedClasses.NativeBrotli);
    handle.close!();
    engine._handle = null;
  }
}

ZlibBase.prototype._destroy = function (err, callback) {
  _close(this);
  callback(err); // Pass the error to the callback
};

ZlibBase.prototype._transform = function (chunk, encoding, cb) {
  let flushFlag = this._defaultFlushFlag;
  // We use a 'fake' zero-length chunk to carry information about flushes from the public API to the actual stream implementation.
  if (typeof (chunk as any)[kFlushFlag] === "number") {
    flushFlag = (chunk as any)[kFlushFlag];
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

function processChunkSync(self: ZlibBase, chunk: BufferType, flushFlag: number): BufferType {
  let availInBefore = chunk.byteLength;
  let availOutBefore = self._chunkSize - self._outOffset;
  let inOff = 0;
  let availOutAfter: number;
  let availInAfter: number;

  const buffers: BufferType[] = [];
  let nread = 0;
  let inputRead = 0;
  const state = self._writeState!;
  const handle = self._handle!;
  let buffer = self._outBuffer;
  let offset = self._outOffset;
  const chunkSize = self._chunkSize;

  let error: Error | undefined;
  // Temporarily listen for errors during sync operation
  const onError = (er: Error) => {
    error = er;
  };
  self.on("error", onError);

  try {
    while (true) {
      // Assuming handle.writeSync is correctly typed now
      (handle.writeSync as any)!(
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
        } else if (!(error instanceof Error)) {
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
        const out = buffer.slice(offset, offset + have);
        offset += have;
        ArrayPrototypePush.$call(buffers, out);
        nread += out.byteLength;

        if (nread > self._maxOutputLength) {
          _close(self);
          throw $ERR_BUFFER_TOO_LARGE(self._maxOutputLength);
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
  } finally {
    self.removeListener("error", onError);
    _close(self); // Ensure handle is closed even on error
  }

  self.bytesWritten = inputRead;

  if (nread === 0) return Buffer.alloc(0);

  // Ensure the return type is BufferType
  const resultBuffer = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers, nread);
  return resultBuffer;
}

function processChunk(self: ZlibBase, chunk: BufferType, flushFlag: number, cb: (error?: Error | null) => void) {
  const handle = self._handle;
  if (!handle) return process.nextTick(cb);

  handle.buffer = chunk;
  handle.cb = cb;
  handle.availOutBefore = self._chunkSize - self._outOffset;
  handle.availInBefore = chunk.byteLength;
  handle.inOff = 0;
  handle.flushFlag = flushFlag;

  // Assuming handle.write is correctly typed now
  (handle.write as any)!(
    flushFlag, // flush
    chunk, // in
    0, // in_off
    handle.availInBefore, // in_len
    self._outBuffer, // out
    self._outOffset, // out_off
    handle.availOutBefore, // out_len
  );
}

// This function is called back from the native binding.
// It assumes 'this' is the native handle.
function processCallback(this: ZlibHandle) {
  // This callback's context (`this`) is the `_handle` (ZCtx) object. It is
  // important to null out the values once they are no longer needed since
  // `_handle` can stay in memory long after the buffer is needed.
  const self = this[owner_symbol]!; // Assert owner exists
  const state = self._writeState!;

  // Check if the stream was destroyed during the async operation
  if (self.destroyed) {
    if (this.cb) {
      // Call the callback with null error to satisfy TS, actual error handled by destroy
      (this.cb as (err: Error | null) => void)(null);
      this.buffer = undefined; // Clear buffer reference
      this.cb = undefined; // Clear callback reference
    }
    return;
  }

  const availOutAfter = state[0];
  const availInAfter = state[1];

  const inDelta = this.availInBefore! - availInAfter;
  self.bytesWritten += inDelta;

  const have = this.availOutBefore! - availOutAfter;
  let streamBufferIsFull = false;
  if (have > 0) {
    const out = self._outBuffer.slice(self._outOffset, self._outOffset + have);
    self._outOffset += have;
    streamBufferIsFull = !self.push(out);
  } else {
    assert(have === 0, "have should not go down");
  }

  // Check again if destroyed after push
  if (self.destroyed) {
    if (this.cb) {
      (this.cb as (err: Error | null) => void)(null); // Satisfy TS
      this.buffer = undefined;
      this.cb = undefined;
    }
    return;
  }

  // Exhausted the output buffer, or used all the input create a new one.
  if (availOutAfter === 0 || self._outOffset >= (self as ZlibBase)._chunkSize) {
    this.availOutBefore = (self as ZlibBase)._chunkSize;
    self._outOffset = 0;
    self._outBuffer = Buffer.allocUnsafe((self as ZlibBase)._chunkSize);
  }

  if (availOutAfter === 0) {
    // Not actually done. Need to reprocess.
    // Also, update the availInBefore to the availInAfter value,
    // so that if we have to hit it a third (fourth, etc.) time,
    // it'll have the correct byte counts.
    this.inOff! += inDelta;
    this.availInBefore = availInAfter;

    if (!streamBufferIsFull) {
      // Assuming this.write is correctly typed now
      (this.write as any)!(
        this.flushFlag!, // flush
        this.buffer!, // in
        this.inOff!, // in_off
        this.availInBefore, // in_len
        self._outBuffer, // out
        self._outOffset, // out_off
        (self as ZlibBase)._chunkSize, // out_len
      );
    } else {
      // If the stream buffer is full, wait for 'drain' before writing again.
      // Temporarily store the write arguments and re-issue the write on drain.
      const oldRead = self._read; // Store original _read
      self._read = n => {
        self._read = oldRead; // Restore original _read
        // Assuming this.write is correctly typed now
        (this.write as any)!(
          this.flushFlag!,
          this.buffer!,
          this.inOff!,
          this.availInBefore!,
          self._outBuffer,
          self._outOffset,
          (self as ZlibBase)._chunkSize,
        );
        // Call the original _read if it exists and is a function
        if (typeof oldRead === "function") {
          oldRead.call(self, n);
        }
      };
    }
    return;
  }

  if (availInAfter > 0 && this.flushFlag !== Z_FINISH) {
    // If we have more input that should be written, but we also have output
    // space available, that means that the compression library was not
    // interested in receiving more data, and in particular that the input
    // stream has ended early.
    // This applies to streams where we don't check data past the end of
    // what was consumed; that is, everything except Gunzip/Unzip.
    // Don't push null if we are finishing.
    self.push(null);
  }

  // Finished with the chunk.
  const cb = this.cb as (error?: Error | null) => void | undefined; // Cast to expected type
  this.buffer = undefined;
  this.cb = undefined;
  if (cb) {
    cb(null); // Call the callback with null error now that processing is done
  }
}

const zlibDefaultOpts = {
  flush: Z_NO_FLUSH,
  finishFlush: Z_FINISH,
  fullFlush: Z_FULL_FLUSH,
};
// Base class for all streams actually backed by zlib and using zlib-specific
// parameters.
function Zlib(this: ZlibBase, opts: ZlibOptions | undefined, mode: number) {
  let windowBits = Z_DEFAULT_WINDOWBITS;
  let level = Z_DEFAULT_COMPRESSION;
  let memLevel = Z_DEFAULT_MEMLEVEL;
  let strategy = Z_DEFAULT_STRATEGY;
  let dictionary: BufferType | ArrayBuffer | ArrayBufferView | undefined;

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
        throw $ERR_INVALID_ARG_TYPE("options.dictionary", ["Buffer", "TypedArray", "DataView", "ArrayBuffer"], dictionary);
      }
    }
  }

  const handle = new NativeZlib(mode);
  this._writeState = new Uint32Array(2);
  // Assuming NativeZlib.init takes 7 arguments based on usage and comments.
  // The definition in ZigGeneratedClasses.d.ts should be updated.
  (handle.init as any)!(
    windowBits,
    level,
    memLevel,
    strategy,
    this._writeState,
    processCallback,
    dictionary,
  );

  ZlibBase.call(this, opts, mode, handle, zlibDefaultOpts);

  this._level = level;
  this._strategy = strategy;
}
$toClass(Zlib, "Zlib", ZlibBase);

// This callback is used by `.params()` to wait until a full flush happened before adjusting the parameters.
// In particular, the call to the native `params()` function should not happen while a write is currently in progress on the threadpool.
function paramsAfterFlushCallback(this: ZlibBase, level: number, strategy: number, callback?: () => void, error?: Error | null) {
  if (error) {
    if (callback) callback(); // Or maybe pass the error? Node.js behavior? Let's just call it.
    return;
  }
  assert(this._handle, "zlib binding closed");
  // Assuming NativeZlib.params takes 2 arguments based on usage.
  // The definition in ZigGeneratedClasses.d.ts should be updated.
  (this._handle.params as any)!(level, strategy);
  if (!this.destroyed) {
    this._level = level;
    this._strategy = strategy;
    if (callback) callback();
  } else if (callback) {
    callback(); // Call callback even if destroyed after flush but before params set? Seems reasonable.
  }
}

Zlib.prototype.params = function params(level: number, strategy: number, callback: () => void) {
  checkRangesOrGetDefault(level, "level", Z_MIN_LEVEL, Z_MAX_LEVEL, Z_DEFAULT_COMPRESSION); // Provide default for check
  checkRangesOrGetDefault(strategy, "strategy", Z_DEFAULT_STRATEGY, Z_FIXED, Z_DEFAULT_STRATEGY); // Provide default for check

  if (this._level !== level || this._strategy !== strategy) {
    // The flush callback expects no arguments. Pass a wrapper that calls paramsAfterFlushCallback.
    this.flush(Z_SYNC_FLUSH, () => {
      paramsAfterFlushCallback.call(this, level, strategy, callback, null);
    });
  } else {
    process.nextTick(callback);
  }
};

function Deflate(this: ZlibBase, opts?: ZlibOptions) {
  if (!(this instanceof Deflate)) return new (Deflate as any)(opts);
  Zlib.call(this, opts, DEFLATE);
}
$toClass(Deflate, "Deflate", Zlib);

function Inflate(this: ZlibBase, opts?: ZlibOptions) {
  if (!(this instanceof Inflate)) return new (Inflate as any)(opts);
  Zlib.call(this, opts, INFLATE);
}
$toClass(Inflate, "Inflate", Zlib);

function Gzip(this: ZlibBase, opts?: ZlibOptions) {
  if (!(this instanceof Gzip)) return new (Gzip as any)(opts);
  Zlib.call(this, opts, GZIP);
}
$toClass(Gzip, "Gzip", Zlib);

function Gunzip(this: ZlibBase, opts?: ZlibOptions) {
  if (!(this instanceof Gunzip)) return new (Gunzip as any)(opts);
  Zlib.call(this, opts, GUNZIP);
}
$toClass(Gunzip, "Gunzip", Zlib);

function DeflateRaw(this: ZlibBase, opts?: ZlibOptions) {
  if (opts && opts.windowBits === 8) opts.windowBits = 9;
  if (!(this instanceof DeflateRaw)) return new (DeflateRaw as any)(opts);
  Zlib.call(this, opts, DEFLATERAW);
}
$toClass(DeflateRaw, "DeflateRaw", Zlib);

function InflateRaw(this: ZlibBase, opts?: ZlibOptions) {
  if (!(this instanceof InflateRaw)) return new (InflateRaw as any)(opts);
  Zlib.call(this, opts, INFLATERAW);
}
$toClass(InflateRaw, "InflateRaw", Zlib);

function Unzip(this: ZlibBase, opts?: ZlibOptions) {
  if (!(this instanceof Unzip)) return new (Unzip as any)(opts);
  Zlib.call(this, opts, UNZIP);
}
$toClass(Unzip, "Unzip", Zlib);

type ZlibSyncFn = (
  buffer: string | BufferType | ArrayBuffer | ArrayBufferView,
  opts?: ZlibOptions | BrotliOptions,
) => BufferType | { buffer: BufferType; engine: ZlibBase };

type ZlibAsyncFn = (
  buffer: string | BufferType | ArrayBuffer | ArrayBufferView,
  optsOrCallback?: ZlibOptions | BrotliOptions | ZlibCallback,
  callback?: ZlibCallback,
) => void;

type ZlibConstructor =
  | typeof Deflate
  | typeof Inflate
  | typeof Gzip
  | typeof Gunzip
  | typeof DeflateRaw
  | typeof InflateRaw
  | typeof Unzip
  | typeof BrotliCompress
  | typeof BrotliDecompress;

function createConvenienceMethod(
  ctor: ZlibConstructor,
  sync: boolean,
  methodName: string,
): ZlibSyncFn | ZlibAsyncFn {
  if (sync) {
    const fn: ZlibSyncFn = function (buffer: string | BufferType | ArrayBuffer | ArrayBufferView, opts?: ZlibOptions | BrotliOptions) {
      // Explicit cast to satisfy TS - the types should be compatible, but inference might be failing.
      return zlibBufferSync(new (ctor as any)(opts), buffer) as (BufferType | { buffer: BufferType; engine: ZlibBase });
    };
    ObjectDefineProperty(fn, "name", { value: methodName, configurable: true });
    return fn;
  } else {
    const fn: ZlibAsyncFn = function (
      buffer: string | BufferType | ArrayBuffer | ArrayBufferView,
      optsOrCallback?: ZlibOptions | BrotliOptions | ZlibCallback,
      callback?: ZlibCallback,
    ) {
      let options: ZlibOptions | BrotliOptions | undefined;
      if (typeof optsOrCallback === "function") {
        callback = optsOrCallback;
        options = {};
      } else {
        options = optsOrCallback;
      }

      if (typeof callback !== "function") {
        // This case should ideally not happen if called correctly,
        // but helps satisfy TS if opts is options object.
        throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
      }
      return zlibBuffer(new (ctor as any)(options), buffer, callback);
    };
    ObjectDefineProperty(fn, "name", { value: methodName, configurable: true });
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
function Brotli(this: ZlibBase, opts: BrotliOptions | undefined, mode: number) {
  assert(mode === BROTLI_DECODE || mode === BROTLI_ENCODE);

  TypedArrayPrototypeFill.$call(brotliInitParamsArray, -1);
  if (opts?.params) {
    ArrayPrototypeForEach.$call(ObjectKeys(opts.params), origKey => {
      const key = +origKey;
      if (NumberIsNaN(key) || key < 0 || key > kMaxBrotliParam || (brotliInitParamsArray[key] | 0) !== -1) {
        throw $ERR_BROTLI_INVALID_PARAM(key);
      }

      const value = opts.params![origKey as keyof typeof opts.params];
      if (typeof value !== "number" && typeof value !== "boolean") {
        throw $ERR_INVALID_ARG_TYPE("options.params[key]", ["number", "boolean"], value);
      }
      brotliInitParamsArray[key] = +value; // Convert boolean to 0/1
    });
  }

  const handle = new NativeBrotli(mode);

  this._writeState = new Uint32Array(2);
  // Assuming NativeBrotli.init takes 3 arguments based on usage and comments.
  // The definition in ZigGeneratedClasses.d.ts should be updated.
  if (!(handle.init as any)!(brotliInitParamsArray, this._writeState, processCallback)) {
    throw $ERR_ZLIB_INITIALIZATION_FAILED();
  }

  ZlibBase.call(this, opts, mode, handle, brotliDefaultOpts);
}
$toClass(Brotli, "Brotli", ZlibBase); // Note: Brotli extends ZlibBase, not Zlib

function BrotliCompress(this: ZlibBase, opts?: BrotliOptions) {
  if (!(this instanceof BrotliCompress)) return new (BrotliCompress as any)(opts);
  Brotli.call(this, opts, BROTLI_ENCODE);
}
$toClass(BrotliCompress, "BrotliCompress", Brotli);

function BrotliDecompress(this: ZlibBase, opts?: BrotliOptions) {
  if (!(this instanceof BrotliDecompress)) return new (BrotliDecompress as any)(opts);
  Brotli.call(this, opts, BROTLI_DECODE);
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
ObjectDefineProperty(NativeBrotli.prototype, "jsref", {
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

  deflate: createConvenienceMethod(Deflate, false, "deflate") as ZlibAsyncFn,
  deflateSync: createConvenienceMethod(Deflate, true, "deflateSync") as ZlibSyncFn,
  gzip: createConvenienceMethod(Gzip, false, "gzip") as ZlibAsyncFn,
  gzipSync: createConvenienceMethod(Gzip, true, "gzipSync") as ZlibSyncFn,
  deflateRaw: createConvenienceMethod(DeflateRaw, false, "deflateRaw") as ZlibAsyncFn,
  deflateRawSync: createConvenienceMethod(DeflateRaw, true, "deflateRawSync") as ZlibSyncFn,
  unzip: createConvenienceMethod(Unzip, false, "unzip") as ZlibAsyncFn,
  unzipSync: createConvenienceMethod(Unzip, true, "unzipSync") as ZlibSyncFn,
  inflate: createConvenienceMethod(Inflate, false, "inflate") as ZlibAsyncFn,
  inflateSync: createConvenienceMethod(Inflate, true, "inflateSync") as ZlibSyncFn,
  gunzip: createConvenienceMethod(Gunzip, false, "gunzip") as ZlibAsyncFn,
  gunzipSync: createConvenienceMethod(Gunzip, true, "gunzipSync") as ZlibSyncFn,
  inflateRaw: createConvenienceMethod(InflateRaw, false, "inflateRaw") as ZlibAsyncFn,
  inflateRawSync: createConvenienceMethod(InflateRaw, true, "inflateRawSync") as ZlibSyncFn,
  brotliCompress: createConvenienceMethod(BrotliCompress, false, "brotliCompress") as ZlibAsyncFn,
  brotliCompressSync: createConvenienceMethod(BrotliCompress, true, "brotliCompressSync") as ZlibSyncFn,
  brotliDecompress: createConvenienceMethod(BrotliDecompress, false, "brotliDecompress") as ZlibAsyncFn,
  brotliDecompressSync: createConvenienceMethod(BrotliDecompress, true, "brotliDecompressSync") as ZlibSyncFn,

  createDeflate: function (options?: ZlibOptions): import("node:zlib").Deflate {
    return new (Deflate as any)(options);
  },
  createInflate: function (options?: ZlibOptions): import("node:zlib").Inflate {
    return new (Inflate as any)(options);
  },
  createDeflateRaw: function (options?: ZlibOptions): import("node:zlib").DeflateRaw {
    return new (DeflateRaw as any)(options);
  },
  createInflateRaw: function (options?: ZlibOptions): import("node:zlib").InflateRaw {
    return new (InflateRaw as any)(options);
  },
  createGzip: function (options?: ZlibOptions): import("node:zlib").Gzip {
    return new (Gzip as any)(options);
  },
  createGunzip: function (options?: ZlibOptions): import("node:zlib").Gunzip {
    return new (Gunzip as any)(options);
  },
  createUnzip: function (options?: ZlibOptions): import("node:zlib").Unzip {
    return new (Unzip as any)(options);
  },
  createBrotliCompress: function (options?: BrotliOptions): import("node:zlib").BrotliCompress {
    return new (BrotliCompress as any)(options);
  },
  createBrotliDecompress: function (options?: BrotliOptions): import("node:zlib").BrotliDecompress {
    return new (BrotliDecompress as any)(options);
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
  ObjectDefineProperty(zlib, "Z_NO_FLUSH", { value: Z_NO_FLUSH, enumerable: false });
  ObjectDefineProperty(zlib, "Z_PARTIAL_FLUSH", { value: Z_PARTIAL_FLUSH, enumerable: false });
  ObjectDefineProperty(zlib, "Z_SYNC_FLUSH", { value: Z_SYNC_FLUSH, enumerable: false });
  ObjectDefineProperty(zlib, "Z_FULL_FLUSH", { value: Z_FULL_FLUSH, enumerable: false });
  ObjectDefineProperty(zlib, "Z_FINISH", { value: Z_FINISH, enumerable: false });
  ObjectDefineProperty(zlib, "Z_BLOCK", { value: Z_BLOCK, enumerable: false });
  ObjectDefineProperty(zlib, "Z_OK", { value: Z_OK, enumerable: false });
  ObjectDefineProperty(zlib, "Z_STREAM_END", { value: Z_STREAM_END, enumerable: false });
  ObjectDefineProperty(zlib, "Z_NEED_DICT", { value: Z_NEED_DICT, enumerable: false });
  ObjectDefineProperty(zlib, "Z_ERRNO", { value: Z_ERRNO, enumerable: false });
  ObjectDefineProperty(zlib, "Z_STREAM_ERROR", { value: Z_STREAM_ERROR, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DATA_ERROR", { value: Z_DATA_ERROR, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MEM_ERROR", { value: Z_MEM_ERROR, enumerable: false });
  ObjectDefineProperty(zlib, "Z_BUF_ERROR", { value: Z_BUF_ERROR, enumerable: false });
  ObjectDefineProperty(zlib, "Z_VERSION_ERROR", { value: Z_VERSION_ERROR, enumerable: false });
  ObjectDefineProperty(zlib, "Z_NO_COMPRESSION", { value: Z_NO_COMPRESSION, enumerable: false });
  ObjectDefineProperty(zlib, "Z_BEST_SPEED", { value: Z_BEST_SPEED, enumerable: false });
  ObjectDefineProperty(zlib, "Z_BEST_COMPRESSION", { value: Z_BEST_COMPRESSION, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DEFAULT_COMPRESSION", { value: Z_DEFAULT_COMPRESSION, enumerable: false });
  ObjectDefineProperty(zlib, "Z_FILTERED", { value: Z_FILTERED, enumerable: false });
  ObjectDefineProperty(zlib, "Z_HUFFMAN_ONLY", { value: Z_HUFFMAN_ONLY, enumerable: false });
  ObjectDefineProperty(zlib, "Z_RLE", { value: Z_RLE, enumerable: false });
  ObjectDefineProperty(zlib, "Z_FIXED", { value: Z_FIXED, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DEFAULT_STRATEGY", { value: Z_DEFAULT_STRATEGY, enumerable: false });
  ObjectDefineProperty(zlib, "ZLIB_VERNUM", { value: ZLIB_VERNUM, enumerable: false });
  ObjectDefineProperty(zlib, "DEFLATE", { value: DEFLATE, enumerable: false });
  ObjectDefineProperty(zlib, "INFLATE", { value: INFLATE, enumerable: false });
  ObjectDefineProperty(zlib, "GZIP", { value: GZIP, enumerable: false });
  ObjectDefineProperty(zlib, "GUNZIP", { value: GUNZIP, enumerable: false });
  ObjectDefineProperty(zlib, "DEFLATERAW", { value: DEFLATERAW, enumerable: false });
  ObjectDefineProperty(zlib, "INFLATERAW", { value: INFLATERAW, enumerable: false });
  ObjectDefineProperty(zlib, "UNZIP", { value: UNZIP, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MIN_WINDOWBITS", { value: Z_MIN_WINDOWBITS, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MAX_WINDOWBITS", { value: Z_MAX_WINDOWBITS, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DEFAULT_WINDOWBITS", { value: Z_DEFAULT_WINDOWBITS, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MIN_CHUNK", { value: Z_MIN_CHUNK, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MAX_CHUNK", { value: Z_MAX_CHUNK, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DEFAULT_CHUNK", { value: Z_DEFAULT_CHUNK, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MIN_MEMLEVEL", { value: Z_MIN_MEMLEVEL, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MAX_MEMLEVEL", { value: Z_MAX_MEMLEVEL, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DEFAULT_MEMLEVEL", { value: Z_DEFAULT_MEMLEVEL, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MIN_LEVEL", { value: Z_MIN_LEVEL, enumerable: false });
  ObjectDefineProperty(zlib, "Z_MAX_LEVEL", { value: Z_MAX_LEVEL, enumerable: false });
  ObjectDefineProperty(zlib, "Z_DEFAULT_LEVEL", { value: Z_DEFAULT_LEVEL, enumerable: false });
}

export default zlib;