export function initializeCompressionStream(this, format) {
  const zlib = require("node:zlib");
  const Readable = require("internal/streams/readable");
  const Writable = require("internal/streams/writable");

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
  $putByIdDirectPrivate(this, "readable", Readable.toWeb(handle));
  $putByIdDirectPrivate(this, "writable", Writable.toWeb(handle));

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
