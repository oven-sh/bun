export function initializeDecompressionStream(this, format) {
  const zlib = require("node:zlib");
  const { newBufferSourceTransformPairFromDuplex } = require("internal/webstreams_adapters");

  const builders = {
    "deflate": zlib.createInflate,
    "deflate-raw": zlib.createInflateRaw,
    "gzip": zlib.createGunzip,
    "brotli": zlib.createBrotliDecompress,
    "zstd": zlib.createZstdDecompress,
  };

  if (!(format in builders))
    throw $ERR_INVALID_ARG_VALUE("format", format, "must be one of: " + Object.keys(builders).join(", "));

  // The Compression Streams spec requires erroring on any bytes that follow the
  // end of the compressed data.
  const transform = newBufferSourceTransformPairFromDuplex(builders[format]({ rejectGarbageAfterEnd: true }));
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
