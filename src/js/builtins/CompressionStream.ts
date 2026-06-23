export function initializeCompressionStream(this, format) {
  // node:zlib NodeMode values (DEFLATE, GZIP, DEFLATERAW, BROTLI_ENCODE,
  // ZSTD_COMPRESS) — the native transformer initializes the matching engine
  // with node:zlib's defaults, so output bytes match the node-backed
  // implementation this replaced.
  const modes = {
    __proto__: null,
    "deflate": 1,
    "deflate-raw": 5,
    "gzip": 3,
    "brotli": 9,
    "zstd": 10,
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
  if (!$inheritsCompressionStream(this)) throw $makeGetterTypeError("CompressionStream", "readable");
  return $getByIdDirectPrivate(this, "readable");
}

$getter;
export function writable(this) {
  if (!$inheritsCompressionStream(this)) throw $makeGetterTypeError("CompressionStream", "writable");
  return $getByIdDirectPrivate(this, "writable");
}
