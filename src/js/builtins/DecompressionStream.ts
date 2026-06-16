export function initializeDecompressionStream(this, format) {
  // node:zlib NodeMode values (INFLATE, GUNZIP, INFLATERAW, BROTLI_DECODE,
  // ZSTD_DECOMPRESS) — see CompressionStream for the encode-side table.
  const modes = {
    __proto__: null,
    "deflate": 2,
    "deflate-raw": 6,
    "gzip": 4,
    "brotli": 8,
    "zstd": 11,
  };

  if (!(format in modes))
    throw $ERR_INVALID_ARG_VALUE("format", format, "must be one of: " + Object.keys(modes).join(", "));

  const transform = $createCompressionTransform(modes[format]);

  $putByIdDirectPrivate(this, "readable", $getByIdDirectPrivate(transform, "readable"));
  $putByIdDirectPrivate(this, "writable", $getByIdDirectPrivate(transform, "writable"));

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
