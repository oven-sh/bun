// This is marked as a constructor because Node.js allows `new Buffer.from`,
// Some legacy dependencies depend on this, see #3638
$constructor;
export function from(value, encodingOrOffset, length) {
  if (typeof value === "string") return new $Buffer(value, encodingOrOffset);

  if (typeof value === "object" && value !== null) {
    if ($inheritsArrayBuffer(value)) return new $Buffer(value, encodingOrOffset, length);
    if ($isTypedArrayView(value)) return new $Buffer(value, encodingOrOffset, length);

    const valueOf = value.valueOf && value.valueOf();
    if (valueOf != null && valueOf !== value && (typeof valueOf === "string" || typeof valueOf === "object")) {
      return Buffer.from(valueOf, encodingOrOffset, length);
    }

    if (value.length !== undefined || $inheritsArrayBuffer(value.buffer)) {
      if (typeof value.length !== "number") return new $Buffer(0);
      if (value.length <= 0) return new $Buffer(0);
      return new $Buffer(value);
    }
    const { type, data } = value;
    if (type === "Buffer" && $isArray(data)) {
      if (data.length <= 0) return new $Buffer(0);
      return new $Buffer(data);
    }

    const toPrimitive = $tryGetByIdWithWellKnownSymbol(value, "toPrimitive");
    if (typeof toPrimitive === "function") {
      const primitive = toPrimitive.$call(value, "string");
      if (typeof primitive === "string") {
        return new $Buffer(primitive, encodingOrOffset);
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
