export function initializeDecompressionStream(this, format) {
  const zlib = require("node:zlib");
  const { newBufferSourceTransformPairFromDuplex } = require("internal/webstreams_adapters");

  const builders = {
    "deflate": zlib.createInflate,
    "deflate-raw": zlib.createInflateRaw,
    "gzip": zlib.createGunzip,
    "brotli": zlib.createBrotliDecompress,
    // The other four already error on input that ends mid-stream, as the spec
    // requires. node:zlib's zstd decoder finishes leniently by default (node
    // never checks the frame ended); ZSTD_e_end turns that check on.
    "zstd": () => zlib.createZstdDecompress({ finishFlush: zlib.constants.ZSTD_e_end }),
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
