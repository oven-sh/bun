export function initializeCompressionStream(this, format) {
  const zlib = require("node:zlib");
  const {
    newReadableWritablePairFromDuplex,
    kValidateChunk,
    kDestroyOnSyncError,
  } = require("internal/webstreams_adapters");
  const { isArrayBufferView, isSharedArrayBuffer } = require("node:util/types");

  const builders = {
    "deflate": zlib.createDeflate,
    "deflate-raw": zlib.createDeflateRaw,
    "gzip": zlib.createGzip,
    "brotli": zlib.createBrotliCompress,
    "zstd": zlib.createZstdCompress,
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
  if (!$inheritsCompressionStream(this)) throw $makeGetterTypeError("CompressionStream", "readable");
  return $getByIdDirectPrivate(this, "readable");
}

$getter;
export function writable(this) {
  if (!$inheritsCompressionStream(this)) throw $makeGetterTypeError("CompressionStream", "writable");
  return $getByIdDirectPrivate(this, "writable");
}
