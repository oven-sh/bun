export function initializeDecompressionStream(this, format) {
  const zlib = require("node:zlib");
  const stream = require("node:stream");

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
  $putByIdDirectPrivate(this, "readable", stream.Readable.toWeb(handle));
  $putByIdDirectPrivate(this, "writable", stream.Writable.toWeb(handle));

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
