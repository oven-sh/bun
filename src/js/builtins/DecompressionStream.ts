export function initializeDecompressionStream(this, format) {
  const zlib = require("node:zlib");
  const {
    newReadableWritablePairFromDuplex,
    kValidateChunk,
    kDestroyOnSyncError,
  } = require("internal/webstreams_adapters");
  const { isArrayBufferView, isSharedArrayBuffer } = require("node:util/types");

  const builders = {
    "deflate": zlib.createInflate,
    "deflate-raw": zlib.createInflateRaw,
    "gzip": zlib.createGunzip,
    "brotli": zlib.createBrotliDecompress,
    "zstd": zlib.createZstdDecompress,
  };

  if (!(format in builders))
    throw $ERR_INVALID_ARG_VALUE("format", format, "must be one of: " + Object.keys(builders).join(", "));

  const handle = builders[format]();
  const transform = newReadableWritablePairFromDuplex(handle, {
    // Per the Compression Streams spec, chunks must be BufferSource
    // (ArrayBuffer or ArrayBufferView not backed by SharedArrayBuffer).
    [kValidateChunk]: function validateBufferSourceChunk(chunk) {
      if (isSharedArrayBuffer(isArrayBufferView(chunk) ? chunk.buffer : chunk)) {
        throw $ERR_INVALID_ARG_TYPE("chunk", ["ArrayBuffer", "Buffer", "TypedArray", "DataView"], chunk);
      }
    },
    [kDestroyOnSyncError]: true,
  });
  $putByIdDirectPrivate(this, "readable", transform.readable);
  $putByIdDirectPrivate(this, "writable", transform.writable);

  return this;
}

$getter;
export function readable(this) {
  if (!$inheritsDecompressionStream(this)) throw $makeGetterTypeError("DecompressionStream", "readable");
  return $getByIdDirectPrivate(this, "readable");
}

$getter;
export function writable(this) {
  if (!$inheritsDecompressionStream(this)) throw $makeGetterTypeError("DecompressionStream", "writable");
  return $getByIdDirectPrivate(this, "writable");
}
