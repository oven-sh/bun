export function from(items) {
  if ($isUndefinedOrNull(items)) {
    throw new TypeError(
      "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object.",
    );
  }

  // TODO: figure out why private symbol not found
  if (
    typeof items === "string" ||
    (typeof items === "object" &&
      ($isTypedArrayView(items) ||
        items instanceof ArrayBuffer ||
        items instanceof SharedArrayBuffer ||
        items instanceof String))
  ) {
    switch ($argumentCount()) {
      case 1: {
        return new $Buffer(items);
      }
      case 2: {
        return new $Buffer(items, $argument(1));
      }
      default: {
        return new $Buffer(items, $argument(1), $argument(2));
      }
    }
  }

  var arrayLike = $toObject(
    items,
    "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
  ) as ArrayLike<any>;

  if (!$isJSArray(arrayLike)) {
    const toPrimitive = $tryGetByIdWithWellKnownSymbol(items, "toPrimitive");

    if (toPrimitive) {
      const primitive = toPrimitive.$call(items, "string");

      if (typeof primitive === "string") {
        switch ($argumentCount()) {
          case 1: {
            return new $Buffer(primitive);
          }
          case 2: {
            return new $Buffer(primitive, $argument(1));
          }
          default: {
            return new $Buffer(primitive, $argument(1), $argument(2));
          }
        }
      }
    }

    if (!("length" in arrayLike) || $isCallable(arrayLike)) {
      throw new TypeError(
        "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
      );
    }
  }

  // Don't pass the second argument because Node's Buffer.from doesn't accept
  // a function and Uint8Array.from requires it if it exists
  // That means we cannot use $tailCallFowrardArguments here, sadly
  return new $Buffer(Uint8Array.from(arrayLike).buffer);
}
