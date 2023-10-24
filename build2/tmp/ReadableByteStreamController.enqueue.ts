// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(chunk) {  if (!__intrinsic__isReadableByteStreamController(this)) throw __intrinsic__makeThisTypeError("ReadableByteStreamController", "enqueue");

  if (__intrinsic__getByIdDirectPrivate(this, "closeRequested"))
    __intrinsic__throwTypeError("ReadableByteStreamController is requested to close");

  if (__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== __intrinsic__streamReadable)
    __intrinsic__throwTypeError("ReadableStream is not readable");

  if (!__intrinsic__isObject(chunk) || !ArrayBuffer.__intrinsic__isView(chunk)) __intrinsic__throwTypeError("Provided chunk is not a TypedArray");

  return __intrinsic__readableByteStreamControllerEnqueue(this, chunk);
}).$$capture_end$$;
