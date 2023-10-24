// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableByteStreamController(this)) throw __intrinsic__makeGetterTypeError("ReadableByteStreamController", "byobRequest");

  var request = __intrinsic__getByIdDirectPrivate(this, "byobRequest");
  if (request === undefined) {
    var pending = __intrinsic__getByIdDirectPrivate(this, "pendingPullIntos");
    const firstDescriptor = pending.peek();
    if (firstDescriptor) {
      const view = new Uint8Array(
        firstDescriptor.buffer,
        firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
        firstDescriptor.byteLength - firstDescriptor.bytesFilled,
      );
      __intrinsic__putByIdDirectPrivate(this, "byobRequest", new ReadableStreamBYOBRequest(this, view, __intrinsic__isReadableStream));
    }
  }

  return __intrinsic__getByIdDirectPrivate(this, "byobRequest");
}).$$capture_end$$;
