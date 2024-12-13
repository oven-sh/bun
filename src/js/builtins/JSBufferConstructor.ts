// This is marked as a constructor because Node.js allows `new Buffer.from`,
// Some legacy dependencies depend on this, see #3638
$constructor;
export function from(value, encodingOrOffset, length) {
  const { fromString, fromArrayBuffer, fromObject } = require("internal/buffer");
  const isAnyArrayBuffer = value => value instanceof ArrayBuffer || value instanceof SharedArrayBuffer;

  if (typeof value === "string") return fromString(value, encodingOrOffset);

  if (typeof value === "object" && value !== null) {
    if (isAnyArrayBuffer(value)) return fromArrayBuffer(value, encodingOrOffset, length);

    const valueOf = value.valueOf && value.valueOf();
    if (valueOf != null && valueOf !== value && (typeof valueOf === "string" || typeof valueOf === "object")) {
      return from(valueOf, encodingOrOffset, length);
    }

    const b = fromObject(value);
    if (b) return b;

    const toPrimitive = $tryGetByIdWithWellKnownSymbol(value, "toPrimitive");
    if (typeof toPrimitive === "function") {
      const primitive = toPrimitive.$call(value, "string");
      if (typeof primitive === "string") {
        return fromString(primitive, encodingOrOffset);
      }
    }
  }

  throw $ERR_INVALID_ARG_TYPE(
    "first argument",
    ["string", "Buffer", "ArrayBuffer", "Array", "Array-like Object"],
    value,
  );
}

export function isBuffer(bufferlike) {
  return bufferlike instanceof $Buffer;
}
