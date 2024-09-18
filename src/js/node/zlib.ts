// Hardcoded module "node:zlib"

const assert = require("node:assert");
const stream = require("node:stream");
const BufferModule = require("node:buffer");
const { ERR_INVALID_ARG_TYPE, ERR_BROTLI_INVALID_PARAM } = require("internal/errors");

const ObjectDefineProperty = Object.defineProperty;
const TypedArrayPrototypeFill = Uint8Array.prototype.fill;
const MathMax = Math.max;
const ArrayPrototypeMap = Array.prototype.map;
const ObjectKeys = Object.keys;
const StringPrototypeStartsWith = String.prototype.startsWith;
const ArrayPrototypeForEach = Array.prototype.forEach;
const NumberIsNaN = Number.isNaN;

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

// TODO: this doesn't match node exactly so improve this more later
const alias = function (proto, to, from) {
  ObjectDefineProperty(proto, to, {
    get: function () {
      return this[kHandle][from];
    },
    set: function (v) {}, // changing these would be a bug
    enumerable: true,
  });
};

//

const constants = $cpp("Constants.cpp", "ZlibConstants");
const modes = {
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
  BROTLI_DECODE: 8,
  BROTLI_ENCODE: 9,
} as const;
const { DEFLATE, INFLATE, GZIP, GUNZIP, DEFLATERAW, INFLATERAW, UNZIP, BROTLI_DECODE, BROTLI_ENCODE } = modes;
type Mode = (typeof modes)[keyof typeof modes];

//

function ZlibBase(options, method: Mode) {
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
ZlibBase.prototype = Object.create(stream.Transform.prototype);
ObjectDefineProperty(ZlibBase.prototype, "_handle", {
  get: function () {
    return this[kHandle];
  },
  set: function (newval) {
    //noop
  },
});
alias(ZlibBase.prototype, "bytesWritten", "bytesWritten");
alias(ZlibBase.prototype, "bytesRead", "bytesRead");
alias(ZlibBase.prototype, "_closed", "closed");
alias(ZlibBase.prototype, "_chunkSize", "chunkSize");
alias(ZlibBase.prototype, "_defaultFlushFlag", "flush");
alias(ZlibBase.prototype, "_finishFlushFlag", "finishFlush");
alias(ZlibBase.prototype, "_defaultFullFlushFlag", "fullFlush");
alias(ZlibBase.prototype, "_maxOutputLength", "maxOutputLength");
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
ZlibBase.prototype.reset = function () {
  assert(this[kHandle], "zlib binding closed");
  return this[kHandle].reset();
};
ZlibBase.prototype.close = function (callback) {
  if (callback) stream.finished(this, callback);
  this.destroy();
};
ZlibBase.prototype._transform = function _transform(chunk, encoding, callback) {
  try {
    callback(undefined, this[kHandle].transformSync(chunk, encoding, false));
  } catch (err) {
    callback(err, undefined);
  }
};
ZlibBase.prototype._flush = function _flush(callback) {
  try {
    callback(undefined, this[kHandle].transformSync("", undefined, true));
  } catch (err) {
    callback(err, undefined);
  }
};
ZlibBase.prototype._final = function (callback) {
  callback();
};
ZlibBase.prototype._processChunk = function (chunk, flushFlag, cb) {
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

function Zlib(options, method: Mode) {
  ZlibBase.$call(this, options, method);
}
Zlib.prototype = Object.create(ZlibBase.prototype);
alias(Zlib.prototype, "_level", "level");
alias(Zlib.prototype, "_strategy", "strategy");
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

const kMaxBrotliParam = MathMax(
  ...(ArrayPrototypeMap<number>).$call(ObjectKeys(constants), key =>
    StringPrototypeStartsWith.$call(key, "BROTLI_PARAM_") ? constants[key] : 0,
  ),
);

const brotliInitParamsArray = new Uint32Array(kMaxBrotliParam + 1);

const brotliDefaultOpts = {
  flush: constants.BROTLI_OPERATION_PROCESS,
  finishFlush: constants.BROTLI_OPERATION_FINISH,
  fullFlush: constants.BROTLI_OPERATION_FLUSH,
};

function Brotli(this: typeof Brotli, opts, mode: Mode) {
  assert(mode === BROTLI_DECODE || mode === BROTLI_ENCODE);
  TypedArrayPrototypeFill.$call(brotliInitParamsArray, -1);

  if (opts?.params) {
    ArrayPrototypeForEach.$call(ObjectKeys(opts.params), origKey => {
      const key = +origKey;
      if (NumberIsNaN(key) || key < 0 || key > kMaxBrotliParam || (brotliInitParamsArray[key] | 0) !== -1) {
        throw ERR_BROTLI_INVALID_PARAM(origKey);
      }
      let value = opts.params[origKey];
      if (typeof value !== "number" && typeof value !== "boolean") {
        throw ERR_INVALID_ARG_TYPE("options.params[key]", "number", opts.params[origKey]);
      }
      if (typeof value === "boolean") value = value ? 1 : 0;
      brotliInitParamsArray[key] = value;
    });
  }
  ZlibBase.$call(this, opts, mode);
}
Brotli.prototype = Object.create(ZlibBase.prototype);

//

function BrotliCompress(opts) {
  if (!(this instanceof BrotliCompress)) return new BrotliCompress(opts);
  Brotli.$call(this, opts, BROTLI_ENCODE);
}
BrotliCompress.prototype = Object.create(Brotli.prototype);

//

function BrotliDecompress(opts) {
  if (!(this instanceof BrotliDecompress)) return new BrotliDecompress(opts);
  Brotli.$call(this, opts, BROTLI_DECODE);
}
BrotliDecompress.prototype = Object.create(Brotli.prototype);

//

function Deflate(opts) {
  if (!(this instanceof Deflate)) return new Deflate(opts);
  Zlib.$call(this, opts, DEFLATE);
}
Deflate.prototype = Object.create(Zlib.prototype);

//

function Inflate(opts) {
  if (!(this instanceof Inflate)) return new Inflate(opts);
  Zlib.$call(this, opts, INFLATE);
}
Inflate.prototype = Object.create(Zlib.prototype);

//

function DeflateRaw(opts) {
  if (!(this instanceof DeflateRaw)) return new DeflateRaw(opts);
  Zlib.$call(this, opts, DEFLATERAW);
}
DeflateRaw.prototype = Object.create(Zlib.prototype);

//

function InflateRaw(opts) {
  if (!(this instanceof InflateRaw)) return new InflateRaw(opts);
  Zlib.$call(this, opts, INFLATERAW);
}
InflateRaw.prototype = Object.create(Zlib.prototype);

//

function Gzip(opts) {
  if (!(this instanceof Gzip)) return new Gzip(opts);
  Zlib.$call(this, opts, GZIP);
}
Gzip.prototype = Object.create(Zlib.prototype);

//

function Gunzip(opts) {
  if (!(this instanceof Gunzip)) return new Gunzip(opts);
  Zlib.$call(this, opts, GUNZIP);
}
Gunzip.prototype = Object.create(Zlib.prototype);

//

function Unzip(opts) {
  if (!(this instanceof Unzip)) return new Unzip(opts);
  Zlib.$call(this, opts, UNZIP);
}
Unzip.prototype = Object.create(Zlib.prototype);

//

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
