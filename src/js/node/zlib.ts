// Hardcoded module "node:zlib"

const stream = require("node:stream");
const BufferModule = require("node:buffer");

const ObjectDefineProperty = Object.defineProperty;

const createBrotliEncoder = $newZigFunction("node_zlib_binding.zig", "createBrotliEncoder", 3);
const createBrotliDecoder = $newZigFunction("node_zlib_binding.zig", "createBrotliDecoder", 3);
const createDeflateEncoder = $newZigFunction("node_zlib_binding.zig", "createDeflateEncoder", 3);
const createDeflateDecoder = $newZigFunction("node_zlib_binding.zig", "createDeflateDecoder", 3);
const createGzipEncoder = $newZigFunction("node_zlib_binding.zig", "createGzipEncoder", 3);
const createGzipDecoder = $newZigFunction("node_zlib_binding.zig", "createGzipDecoder", 3);

const maxOutputLengthDefault = $requireMap.$get("buffer")?.exports.kMaxLength ?? BufferModule.kMaxLength;

//

const kHandle = Symbol("kHandle");

function BrotliCompress(opts) {
  if (!(this instanceof BrotliCompress)) return new BrotliCompress(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createBrotliEncoder(opts, {}, null, 9);
  stream.Transform.$apply(this, arguments);
}
BrotliCompress.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(BrotliCompress.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(BrotliCompress.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
BrotliCompress.prototype.flush = ZlibBase_flush;
BrotliCompress.prototype.reset = ZlibBase_reset;
BrotliCompress.prototype.close = ZlibBase_close;

BrotliCompress.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].encodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
BrotliCompress.prototype._flush = function _flush(callback) {
  try {
    callback(undefined, this[kHandle].encodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function BrotliDecompress(opts) {
  if (!(this instanceof BrotliDecompress)) return new BrotliDecompress(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createBrotliDecoder(opts, {}, null, 8);
  stream.Transform.$apply(this, arguments);
}
BrotliDecompress.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(BrotliDecompress.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(BrotliDecompress.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
BrotliDecompress.prototype.flush = ZlibBase_flush;
BrotliDecompress.prototype.reset = ZlibBase_reset;
BrotliDecompress.prototype.close = ZlibBase_close;

BrotliDecompress.prototype._transform = function (chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].decodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
BrotliDecompress.prototype._flush = function (callback) {
  try {
    callback(undefined, this[kHandle].decodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function Deflate(opts) {
  if (!(this instanceof Deflate)) return new Deflate(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createDeflateEncoder(opts, {}, null, 1);
  stream.Transform.$apply(this, arguments);
}
Deflate.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(Deflate.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(Deflate.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(Deflate.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(Deflate.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(Deflate.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
Deflate.prototype.flush = ZlibBase_flush;
Deflate.prototype.reset = ZlibBase_reset;
Deflate.prototype.close = ZlibBase_close;
Deflate.prototype.params = Zlib_params;

Deflate.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].encodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
Deflate.prototype._flush = function _flush(callback) {
  try {
    callback(undefined, this[kHandle].encodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function Inflate(opts) {
  if (!(this instanceof Inflate)) return new Inflate(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createDeflateDecoder(opts, {}, null, 2);
  stream.Transform.$apply(this, arguments);
}
Inflate.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(Inflate.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(Inflate.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(Inflate.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(Inflate.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(Inflate.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
Inflate.prototype.flush = ZlibBase_flush;
Inflate.prototype.reset = ZlibBase_reset;
Inflate.prototype.close = ZlibBase_close;
Inflate.prototype.params = Zlib_params;

Inflate.prototype._transform = function (chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].decodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
Inflate.prototype._flush = function (callback) {
  try {
    callback(undefined, this[kHandle].decodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function DeflateRaw(opts) {
  if (!(this instanceof DeflateRaw)) return new DeflateRaw(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  if (opts && opts.windowBits === 8) opts.windowBits = 9;
  this[kHandle] = createDeflateEncoder(opts, {}, null, 5);
  stream.Transform.$apply(this, arguments);
}
DeflateRaw.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(DeflateRaw.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(DeflateRaw.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(DeflateRaw.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(DeflateRaw.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(DeflateRaw.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
DeflateRaw.prototype.flush = ZlibBase_flush;
DeflateRaw.prototype.reset = ZlibBase_reset;
DeflateRaw.prototype.close = ZlibBase_close;
DeflateRaw.prototype.params = Zlib_params;

DeflateRaw.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].encodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
DeflateRaw.prototype._flush = function _flush(callback) {
  try {
    callback(undefined, this[kHandle].encodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function InflateRaw(opts) {
  if (!(this instanceof InflateRaw)) return new InflateRaw(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createDeflateDecoder(opts, {}, null, 6);
  stream.Transform.$apply(this, arguments);
}
InflateRaw.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(InflateRaw.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(InflateRaw.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(InflateRaw.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(InflateRaw.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(InflateRaw.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
InflateRaw.prototype.flush = ZlibBase_flush;
InflateRaw.prototype.reset = ZlibBase_reset;
InflateRaw.prototype.close = ZlibBase_close;
InflateRaw.prototype.params = Zlib_params;

InflateRaw.prototype._transform = function (chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].decodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
InflateRaw.prototype._flush = function (callback) {
  try {
    callback(undefined, this[kHandle].decodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function Gzip(opts) {
  if (!(this instanceof Gzip)) return new Gzip(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createGzipEncoder(opts, {}, null, 3);
  stream.Transform.$apply(this, arguments);
}
Gzip.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(Gzip.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(Gzip.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(Gzip.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(Gzip.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(Gzip.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
Gzip.prototype.flush = ZlibBase_flush;
Gzip.prototype.reset = ZlibBase_reset;
Gzip.prototype.close = ZlibBase_close;
Gzip.prototype.params = Zlib_params;

Gzip.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].encodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
Gzip.prototype._flush = function _flush(callback) {
  try {
    callback(undefined, this[kHandle].encodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function Gunzip(opts) {
  if (!(this instanceof Gunzip)) return new Gunzip(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createGzipDecoder(opts, {}, null, 4);
  stream.Transform.$apply(this, arguments);
}
Gunzip.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(Gunzip.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(Gunzip.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(Gunzip.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(Gunzip.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(Gunzip.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
Gunzip.prototype.flush = ZlibBase_flush;
Gunzip.prototype.reset = ZlibBase_reset;
Gunzip.prototype.close = ZlibBase_close;
Gunzip.prototype.params = Zlib_params;

Gunzip.prototype._transform = function (chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].decodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
Gunzip.prototype._flush = function (callback) {
  try {
    callback(undefined, this[kHandle].decodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

function Unzip(opts) {
  if (!(this instanceof Unzip)) return new Unzip(opts);
  if (opts == null) opts = {};
  if ($isObject(opts)) opts.maxOutputLength ??= maxOutputLengthDefault;
  this[kHandle] = createGzipDecoder(opts, {}, null, 7);
  stream.Transform.$apply(this, arguments);
}
Unzip.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(Unzip.prototype, "bytesWritten", {
  get: function () {
    return this[kHandle].bytesWritten;
  },
});
ObjectDefineProperty(Unzip.prototype, "bytesRead", {
  get: function () {
    return this[kHandle].bytesRead;
  },
});
ObjectDefineProperty(Unzip.prototype, "_level", {
  get: function () {
    return this[kHandle].level;
  },
});
ObjectDefineProperty(Unzip.prototype, "_strategy", {
  get: function () {
    return this[kHandle].strategy;
  },
});
ObjectDefineProperty(Unzip.prototype, "_closed", {
  get: function () {
    return this[kHandle].closed;
  },
});
Unzip.prototype.flush = ZlibBase_flush;
Unzip.prototype.reset = ZlibBase_reset;
Unzip.prototype.close = ZlibBase_close;
Unzip.prototype.params = Zlib_params;

Unzip.prototype._transform = function (chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].decodeSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
Unzip.prototype._flush = function (callback) {
  try {
    callback(undefined, this[kHandle].decodeSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};

//

const kFlushFlag = Symbol("kFlushFlag");
const kFlushBuffers: Buffer[] = [];
{
  const dummyArrayBuffer = new ArrayBuffer();
  for (const flushFlag of [0, 1, 2, 3, 4, 5]) {
    kFlushBuffers[flushFlag] = Buffer.from(dummyArrayBuffer);
    kFlushBuffers[flushFlag][kFlushFlag] = flushFlag;
  }
}

function ZlibBase_flush(kind, callback) {
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
}

function ZlibBase_reset() {
  assert(this[kHandle], "zlib binding closed");
  return this[kHandle].reset();
}

function ZlibBase_close(callback) {
  if (callback) stream.finished(this, callback);
  this.destroy();
}

function Zlib_params(level, strategy, callback) {
  // TODO:
}

// TODO: **use a native binding from Bun for this!!**
// This is a very slow module!
// It should really be fixed. It will show up in benchmarking. It also loads
// slowly. We need to fix it!
const assert = require("node:assert");

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
  [Deflate, true, createDeflateEncoder],
  [Inflate, false, createDeflateDecoder],
  [Gzip, true, createGzipEncoder],
  [Gunzip, false, createGzipDecoder],
  [DeflateRaw, true, createDeflateEncoder],
  [InflateRaw, false, createDeflateDecoder],
  [Unzip, false, createGzipDecoder],
  [BrotliDecompress, false, createBrotliDecoder],
  [BrotliCompress, true, createBrotliEncoder],
];

function createConvenienceMethod(method: number, is_sync: boolean) {
  const [pub_constructor, is_encoder, private_constructor] = methods[method];
  const name = pub_constructor.name;

  switch (is_sync) {
    case false:
      return function (buffer, options, callback) {
        if (typeof options === "function") {
          callback = options;
          options = {};
        }
        if (options == null) options = {};
        if ($isObject(options)) options.maxOutputLength ??= maxOutputLengthDefault;
        if (typeof callback !== "function") throw new TypeError(`${name}Encoder callback is not callable`);
        switch (is_encoder) {
          case true:
            const encoder = private_constructor(options, {}, callback, method);
            encoder.encode(buffer, undefined, true);
            return;
          case false:
            const decoder = private_constructor(options, {}, callback, method);
            decoder.decode(buffer, undefined, true);
            return;
        }
      };
    case true:
      return function (buffer, options) {
        if (options == null) options = {};
        if ($isObject(options)) options.maxOutputLength ??= maxOutputLengthDefault;
        switch (is_encoder) {
          case true:
            const encoder = private_constructor(options, {}, null, method);
            return encoder.encodeSync(buffer, undefined, true);
          case false:
            const decoder = private_constructor(options, {}, null, method);
            return decoder.decodeSync(buffer, undefined, true);
        }
      };
  }
}

function createCreator(method: number) {
  return function (opts) {
    return new methods[method][0](opts);
  };
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
Object.defineProperty(zlib, "constants", {
  writable: false,
  configurable: false,
  value: Object.freeze(constants),
});
Object.defineProperty(zlib, "codes", {
  writable: false,
  configurable: false,
  value: Object.freeze(codes),
});

export default zlib;
