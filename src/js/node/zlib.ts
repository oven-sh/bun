// Hardcoded module "node:zlib"

const assert = require("node:assert");
const stream = require("node:stream");
const BufferModule = require("node:buffer");
const { ERR_INVALID_ARG_TYPE } = require("internal/errors");

const ObjectDefineProperty = Object.defineProperty;

const createBrotliEncoder = $newZigFunction("node_zlib_binding.zig", "createBrotliEncoder", 3);
const createBrotliDecoder = $newZigFunction("node_zlib_binding.zig", "createBrotliDecoder", 3);
const createZlibEncoder = $newZigFunction("node_zlib_binding.zig", "createZlibEncoder", 3);
const createZlibDecoder = $newZigFunction("node_zlib_binding.zig", "createZlibDecoder", 3);

const maxOutputLengthDefault = $requireMap.$get("buffer")?.exports.kMaxLength ?? BufferModule.kMaxLength;

//

const kHandle = Symbol("kHandle");
const kFlushFlag = Symbol("kFlushFlag");
const kFlushBuffers: Buffer[] = [];
{
  const dummyArrayBuffer = new ArrayBuffer();
  for (const flushFlag of [0, 1, 2, 3, 4, 5]) {
    kFlushBuffers[flushFlag] = Buffer.from(dummyArrayBuffer);
    kFlushBuffers[flushFlag][kFlushFlag] = flushFlag;
  }
}

//

function Base(method, options) {
  if (options == null) options = {};
  if ($isObject(options)) {
    options.maxOutputLength ??= maxOutputLengthDefault;

    if (options.encoding || options.objectMode || options.writableObjectMode) {
      options = { ...options };
      options.encoding = null;
      options.objectMode = false;
      options.writableObjectMode = false;
    }
  }
  const [, , private_constructor] = methods[method];
  this[kHandle] = private_constructor(options, {}, null, method);
  stream.Transform.$call(this, options);
}
Base.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(Base.prototype, "_handle", {
  get: function () {
    return this[kHandle];
  },
  set: function (newval) {
    //noop
  },
});
ObjectDefineProperty(Base.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(Base.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(Base.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
Base.prototype.flush = function (kind, callback) {
  if (typeof kind === "function" || (kind === undefined && !callback)) {
    callback = kind;
    kind = 3;
  }
  if (this.writableFinished) {
    if (callback) process.nextTick(callback);
  } else if (this.writableEnded) {
    if (callback) this.once("end", callback);
  } else {
    this.write(kFlushBuffers[kind], "", callback);
  }
};
Base.prototype.reset = function () {
  assert(this[kHandle], "zlib binding closed");
  return this[kHandle].reset();
};
Base.prototype.close = function (callback) {
  if (callback) stream.finished(this, callback);
  this.destroy();
};
Base.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].transformSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
Base.prototype._flush = function _flush(callback) {
  try {
    callback(undefined, this[kHandle].transformSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};
Base.prototype._final = function (callback) {
  callback();
};
Base.prototype._processChunk = function (chunk, flushFlag, cb) {
  // _processChunk() is left for backwards compatibility
  if (typeof cb === "function") processChunk(this, chunk, flushFlag, cb);
  else return processChunkSync(this, chunk, flushFlag);
};

function processChunkSync(self, chunk, flushFlag) {
  return self[kHandle].transformSync(chunk, undefined, false, flushFlag);
}

function processChunk(self, chunk, flushFlag, cb) {
  if (self._closed) return process.nextTick(cb);
  self[kHandle].transformSync(chunk, undefined, false, flushFlag);
}

//

function Zlib(method, options) {
  Base.$call(this, method, options);
}
Zlib.prototype = Object.create(Base.prototype);
ObjectDefineProperty(Zlib.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(Zlib.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
Zlib.prototype.params = function (level, strategy, callback) {
  return this[kHandle].params(level, strategy, callback);
};
Zlib.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    this[kHandle].transformWith(chunk, encoding, this, false);
    callback();
  } catch (err) {
    callback(err, undefined);
  }
};

//

function BrotliCompress(opts) {
  if (!(this instanceof BrotliCompress)) return new BrotliCompress(opts);
  Base.$call(this, BROTLI_ENCODE, opts);
}
BrotliCompress.prototype = Object.create(Base.prototype);

//

function BrotliDecompress(opts) {
  if (!(this instanceof BrotliDecompress)) return new BrotliDecompress(opts);
  Base.$call(this, BROTLI_DECODE, opts);
}
BrotliDecompress.prototype = Object.create(Base.prototype);

//

function Deflate(opts) {
  if (!(this instanceof Deflate)) return new Deflate(opts);
  Zlib.$call(this, DEFLATE, opts);
}
Deflate.prototype = Object.create(Zlib.prototype);

//

function Inflate(opts) {
  if (!(this instanceof Inflate)) return new Inflate(opts);
  Zlib.$call(this, INFLATE, opts);
}
Inflate.prototype = Object.create(Zlib.prototype);

//

function DeflateRaw(opts) {
  if (!(this instanceof DeflateRaw)) return new DeflateRaw(opts);
  Zlib.$call(this, DEFLATERAW, opts);
}
DeflateRaw.prototype = Object.create(Zlib.prototype);

//

function InflateRaw(opts) {
  if (!(this instanceof InflateRaw)) return new InflateRaw(opts);
  Zlib.$call(this, INFLATERAW, opts);
}
InflateRaw.prototype = Object.create(Zlib.prototype);

//

function Gzip(opts) {
  if (!(this instanceof Gzip)) return new Gzip(opts);
  Zlib.$call(this, GZIP, opts);
}
Gzip.prototype = Object.create(Zlib.prototype);

//

function Gunzip(opts) {
  if (!(this instanceof Gunzip)) return new Gunzip(opts);
  Zlib.$call(this, GUNZIP, opts);
}
Gunzip.prototype = Object.create(Zlib.prototype);

//

function Unzip(opts) {
  if (!(this instanceof Unzip)) return new Unzip(opts);
  Zlib.$call(this, UNZIP, opts);
}
Unzip.prototype = Object.create(Zlib.prototype);

//

const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  Z_BINARY: 0,
  Z_TEXT: 1,
  Z_ASCII: 1,
  Z_UNKNOWN: 2,
  Z_DEFLATED: 8,
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
  BROTLI_DECODE: 8,
  BROTLI_ENCODE: 9,
  Z_MIN_WINDOWBITS: 8,
  Z_MAX_WINDOWBITS: 15,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64,
  Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1,
  Z_MAX_MEMLEVEL: 9,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1,
  Z_MAX_LEVEL: 9,
  Z_DEFAULT_LEVEL: -1,
  BROTLI_OPERATION_PROCESS: 0,
  BROTLI_OPERATION_FLUSH: 1,
  BROTLI_OPERATION_FINISH: 2,
  BROTLI_OPERATION_EMIT_METADATA: 3,
  BROTLI_PARAM_MODE: 0,
  BROTLI_MODE_GENERIC: 0,
  BROTLI_MODE_TEXT: 1,
  BROTLI_MODE_FONT: 2,
  BROTLI_DEFAULT_MODE: 0,
  BROTLI_PARAM_QUALITY: 1,
  BROTLI_MIN_QUALITY: 0,
  BROTLI_MAX_QUALITY: 11,
  BROTLI_DEFAULT_QUALITY: 11,
  BROTLI_PARAM_LGWIN: 2,
  BROTLI_MIN_WINDOW_BITS: 10,
  BROTLI_MAX_WINDOW_BITS: 24,
  BROTLI_LARGE_MAX_WINDOW_BITS: 30,
  BROTLI_DEFAULT_WINDOW: 22,
  BROTLI_PARAM_LGBLOCK: 3,
  BROTLI_MIN_INPUT_BLOCK_BITS: 16,
  BROTLI_MAX_INPUT_BLOCK_BITS: 24,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: 4,
  BROTLI_PARAM_SIZE_HINT: 5,
  BROTLI_PARAM_LARGE_WINDOW: 6,
  BROTLI_PARAM_NPOSTFIX: 7,
  BROTLI_PARAM_NDIRECT: 8,
  BROTLI_DECODER_RESULT_ERROR: 0,
  BROTLI_DECODER_RESULT_SUCCESS: 1,
  BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: 2,
  BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: 3,
  BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: 0,
  BROTLI_DECODER_PARAM_LARGE_WINDOW: 1,
  BROTLI_DECODER_NO_ERROR: 0,
  BROTLI_DECODER_SUCCESS: 1,
  BROTLI_DECODER_NEEDS_MORE_INPUT: 2,
  BROTLI_DECODER_NEEDS_MORE_OUTPUT: 3,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE: -1,
  BROTLI_DECODER_ERROR_FORMAT_RESERVED: -2,
  BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE: -3,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET: -4,
  BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME: -5,
  BROTLI_DECODER_ERROR_FORMAT_CL_SPACE: -6,
  BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE: -7,
  BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT: -8,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1: -9,
  BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2: -10,
  BROTLI_DECODER_ERROR_FORMAT_TRANSFORM: -11,
  BROTLI_DECODER_ERROR_FORMAT_DICTIONARY: -12,
  BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS: -13,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_1: -14,
  BROTLI_DECODER_ERROR_FORMAT_PADDING_2: -15,
  BROTLI_DECODER_ERROR_FORMAT_DISTANCE: -16,
  BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET: -19,
  BROTLI_DECODER_ERROR_INVALID_ARGUMENTS: -20,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES: -21,
  BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS: -22,
  BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP: -25,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1: -26,
  BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2: -27,
  BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES: -30,
  BROTLI_DECODER_ERROR_UNREACHABLE: -31,
};
const { DEFLATE, INFLATE, GZIP, GUNZIP, DEFLATERAW, INFLATERAW, UNZIP, BROTLI_DECODE, BROTLI_ENCODE } = constants;

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

for (const ckey of Object.keys(codes)) {
  codes[codes[ckey]] = ckey;
}

const methods = [
  [],
  [Deflate, true, createZlibEncoder],
  [Inflate, false, createZlibDecoder],
  [Gzip, true, createZlibEncoder],
  [Gunzip, false, createZlibDecoder],
  [DeflateRaw, true, createZlibEncoder],
  [InflateRaw, false, createZlibDecoder],
  [Unzip, false, createZlibDecoder],
  [BrotliDecompress, false, createBrotliDecoder],
  [BrotliCompress, true, createBrotliEncoder],
] as const;

function createConvenienceMethod(method: number, is_sync: boolean) {
  const [, , private_constructor] = methods[method];

  switch (is_sync) {
    case false:
      return function (buffer, options, callback) {
        if (typeof options === "function") {
          callback = options;
          options = {};
        }
        if (options == null) options = {};
        if ($isObject(options)) options.maxOutputLength ??= maxOutputLengthDefault;
        if (typeof callback !== "function") throw ERR_INVALID_ARG_TYPE("callback", "function", callback);
        const coder = private_constructor(options, {}, callback, method);
        coder.transform(buffer, undefined, true);
      };
    case true:
      return function (buffer, options) {
        if (options == null) options = {};
        if ($isObject(options)) options.maxOutputLength ??= maxOutputLengthDefault;
        const coder = private_constructor(options, {}, null, method);
        return coder.transformSync(buffer, undefined, true);
      };
  }
}

function createCreator(method: number) {
  const Constructor = methods[method][0];
  return function (opts) {
    return new Constructor(opts);
  };
}

const functions = {
  crc32: $newZigFunction("node_zlib_binding.zig", "crc32", 1),

  deflate: createConvenienceMethod(DEFLATE, false),
  deflateSync: createConvenienceMethod(DEFLATE, true),
  gzip: createConvenienceMethod(GZIP, false),
  gzipSync: createConvenienceMethod(GZIP, true),
  deflateRaw: createConvenienceMethod(DEFLATERAW, false),
  deflateRawSync: createConvenienceMethod(DEFLATERAW, true),
  unzip: createConvenienceMethod(UNZIP, false),
  unzipSync: createConvenienceMethod(UNZIP, true),
  inflate: createConvenienceMethod(INFLATE, false),
  inflateSync: createConvenienceMethod(INFLATE, true),
  gunzip: createConvenienceMethod(GUNZIP, false),
  gunzipSync: createConvenienceMethod(GUNZIP, true),
  inflateRaw: createConvenienceMethod(INFLATERAW, false),
  inflateRawSync: createConvenienceMethod(INFLATERAW, true),
  brotliCompress: createConvenienceMethod(BROTLI_ENCODE, false),
  brotliCompressSync: createConvenienceMethod(BROTLI_ENCODE, true),
  brotliDecompress: createConvenienceMethod(BROTLI_DECODE, false),
  brotliDecompressSync: createConvenienceMethod(BROTLI_DECODE, true),

  createDeflate: createCreator(DEFLATE),
  createInflate: createCreator(INFLATE),
  createDeflateRaw: createCreator(DEFLATERAW),
  createInflateRaw: createCreator(INFLATERAW),
  createGzip: createCreator(GZIP),
  createGunzip: createCreator(GUNZIP),
  createUnzip: createCreator(UNZIP),
  createBrotliCompress: createCreator(BROTLI_ENCODE),
  createBrotliDecompress: createCreator(BROTLI_DECODE),
};
for (const f in functions) {
  Object.defineProperty(functions[f], "name", {
    value: f,
  });
}

const zlib = {
  Deflate,
  Inflate,
  Gzip,
  Gunzip,
  DeflateRaw,
  InflateRaw,
  Unzip,
  BrotliCompress,
  BrotliDecompress,

  ...functions,
};
Object.defineProperty(zlib, "constants", {
  writable: false,
  configurable: false,
  enumerable: true,
  value: Object.freeze(constants),
});
Object.defineProperty(zlib, "codes", {
  writable: false,
  configurable: false,
  enumerable: true,
  value: Object.freeze(codes),
});

export default zlib;
