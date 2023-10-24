// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableByteStreamController(this)) throw __intrinsic__makeThisTypeError("ReadableByteStreamController", "close");

  if (__intrinsic__getByIdDirectPrivate(this, "closeRequested")) __intrinsic__throwTypeError("Close has already been requested");

  if (__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== __intrinsic__streamReadable)
    __intrinsic__throwTypeError("ReadableStream is not readable");

  __intrinsic__readableByteStreamControllerClose(this);
}).$$capture_end$$;
