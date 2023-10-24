// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/JSBufferConstructor.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(items) {  if (__intrinsic__isUndefinedOrNull(items)) {
    __intrinsic__throwTypeError(
      "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object.",
    );
  }

  // TODO: figure out why private symbol not found
  if (
    typeof items === "string" ||
    (typeof items === "object" &&
      (__intrinsic__isTypedArrayView(items) ||
        items instanceof ArrayBuffer ||
        items instanceof SharedArrayBuffer ||
        items instanceof String))
  ) {
    switch (__intrinsic__argumentCount()) {
      case 1: {
        return new __intrinsic__Buffer(items);
      }
      case 2: {
        return new __intrinsic__Buffer(items, __intrinsic__argument(1));
      }
      default: {
        return new __intrinsic__Buffer(items, __intrinsic__argument(1), __intrinsic__argument(2));
      }
    }
  }

  var arrayLike = __intrinsic__toObject(
    items,
    "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
  ) as ArrayLike<any>;

  if (!__intrinsic__isJSArray(arrayLike)) {
    const toPrimitive = __intrinsic__tryGetByIdWithWellKnownSymbol(items, "toPrimitive");

    if (toPrimitive) {
      const primitive = toPrimitive.__intrinsic__call(items, "string");

      if (typeof primitive === "string") {
        switch (__intrinsic__argumentCount()) {
          case 1: {
            return new __intrinsic__Buffer(primitive);
          }
          case 2: {
            return new __intrinsic__Buffer(primitive, __intrinsic__argument(1));
          }
          default: {
            return new __intrinsic__Buffer(primitive, __intrinsic__argument(1), __intrinsic__argument(2));
          }
        }
      }
    }

    if (!("length" in arrayLike) || __intrinsic__isCallable(arrayLike)) {
      __intrinsic__throwTypeError(
        "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
      );
    }
  }

  // Don't pass the second argument because Node's Buffer.from doesn't accept
  // a function and Uint8Array.from requires it if it exists
  // That means we cannot use $tailCallFowrardArguments here, sadly
  return new __intrinsic__Buffer(Uint8Array.from(arrayLike).buffer);
}).$$capture_end$$;
