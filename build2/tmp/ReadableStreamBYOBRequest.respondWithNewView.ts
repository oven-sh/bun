// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamBYOBRequest.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(view) {  if (!__intrinsic__isReadableStreamBYOBRequest(this)) throw __intrinsic__makeThisTypeError("ReadableStreamBYOBRequest", "respond");

  if (__intrinsic__getByIdDirectPrivate(this, "associatedReadableByteStreamController") === undefined)
    __intrinsic__throwTypeError("ReadableStreamBYOBRequest.associatedReadableByteStreamController is undefined");

  if (!__intrinsic__isObject(view)) __intrinsic__throwTypeError("Provided view is not an object");

  if (!ArrayBuffer.__intrinsic__isView(view)) __intrinsic__throwTypeError("Provided view is not an ArrayBufferView");

  return __intrinsic__readableByteStreamControllerRespondWithNewView(
    __intrinsic__getByIdDirectPrivate(this, "associatedReadableByteStreamController"),
    view,
  );
}).$$capture_end$$;
