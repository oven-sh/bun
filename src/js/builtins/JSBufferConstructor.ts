import { Buffer } from "node:buffer";

// This is marked as a constructor because Node.js allows `new Buffer.from`,
// Some legacy dependencies depend on this, see #3638
$constructor;
export function from(value, encodingOrOffset, length) {
  if (typeof value === "string") return new $Buffer(value, encodingOrOffset);

  if (typeof value === "object" && value !== null) {
    if ($inheritsArrayBuffer(value)) return new $Buffer(value, encodingOrOffset, length);
    if ($isTypedArrayView(value)) {
      // Ensure we pass the underlying ArrayBuffer, byteOffset, and length
      // The `encodingOrOffset` parameter serves as the byteOffset here.
      // The `length` parameter serves as the length.
      // $Buffer constructor handles TypedArray correctly, but we need to extract buffer, offset, length manually
      // to match Node.js Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength) behavior
      // when encodingOrOffset/length are provided.
      // However, the $Buffer constructor overload for ArrayBuffer already takes byteOffset and length.
      // Let's stick to the simpler path if encodingOrOffset/length are undefined.
      if (encodingOrOffset === undefined && length === undefined) {
        return new $Buffer(value);
      }
      // If offset/length are provided, use the ArrayBuffer overload explicitly
      return new $Buffer(value.buffer as ArrayBuffer, encodingOrOffset ?? value.byteOffset, length ?? value.byteLength);
    }

    const valueOf = value.valueOf && value.valueOf();
    // Check if valueOf is different and is a string or object (could be another buffer-like object)
    if (valueOf != null && valueOf !== value && (typeof valueOf === "string" || typeof valueOf === "object")) {
      // The recursive call handles the type checking for valueOf
      return Buffer.from(valueOf, encodingOrOffset, length);
    }

    // Handle Array-like objects (including Buffers passed as Array-like)
    // Node.js Buffer.from([1, 2, 3]) works
    // Check if value.buffer exists and inherits from ArrayBuffer (covers Buffer itself)
    // Also check for plain arrays or array-like objects with a length property.
    if (
      $isArray(value) ||
      (value.length !== undefined && typeof value.length === "number" && value.length >= 0) ||
      ($isObject(value.buffer) && $inheritsArrayBuffer(value.buffer))
    ) {
      if (typeof value.length !== "number" || value.length < 0) {
        // Node.js behavior for invalid length in array-like is new Buffer(0)
        return new $Buffer(0);
      }
      // This covers Buffer, Uint8Array, Array, etc. passed directly
      // The $Buffer constructor handles these array-like types correctly in its Array overload.
      return new $Buffer(value);
    }

    // Handle Node.js specific Buffer JSON representation { type: 'Buffer', data: [...] }
    const { type, data } = value;
    if (type === "Buffer" && $isArray(data)) {
      if (data.length <= 0) return new $Buffer(0);
      // Pass the data array to the $Buffer constructor
      return new $Buffer(data);
    }

    // Handle objects with Symbol.toPrimitive
    const toPrimitive = $tryGetByIdWithWellKnownSymbol(value, "toPrimitive");
    if (typeof toPrimitive === "function") {
      const primitive = toPrimitive.$call(value, "string");
      if (typeof primitive === "string") {
        // Pass the primitive string and original encoding/offset
        return new $Buffer(primitive, encodingOrOffset);
      }
      // If toPrimitive doesn't return a string, fall through to the error
    }
  }

  throw $ERR_INVALID_ARG_TYPE(
    "first argument",
    ["string", "Buffer", "ArrayBuffer", "Array", "Array-like Object"],
    value,
  );
}

export function isBuffer(bufferlike) {
  // Use instanceof check which is reliable for Buffers created within the same realm
  // and handles Buffer subclasses correctly.
  return bufferlike instanceof $Buffer;
}