export function initializeCompressionStream(this, format) {
  const zlib = require("node:zlib");

  const builders = {
    "deflate": zlib.createDeflate,
    "deflate-raw": zlib.createDeflateRaw,
    "gzip": zlib.createGzip,
    "brotli": zlib.createBrotliCompress,
    "zstd": zlib.createZstdCompress,
  };

  if (!(format in builders))
    throw $ERR_INVALID_ARG_VALUE("format", format, "must be one of: " + Object.keys(builders).join(", "));

  // The engine is a node:zlib stream, but its Duplex surface is never used:
  // the native handle is driven synchronously in $createCompressionTransform,
  // which avoids the per-chunk threadpool round-trip and the
  // Readable/Writable.toWeb adapter machinery (and the extra output copy the
  // Readable adapter makes).
  const transform = $createCompressionTransform(builders[format]());

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
