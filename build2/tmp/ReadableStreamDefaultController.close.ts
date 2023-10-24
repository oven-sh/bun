// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamDefaultController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableStreamDefaultController(this)) throw __intrinsic__makeThisTypeError("ReadableStreamDefaultController", "close");

  if (!__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(this))
    __intrinsic__throwTypeError("ReadableStreamDefaultController is not in a state where it can be closed");

  __intrinsic__readableStreamDefaultControllerClose(this);
}).$$capture_end$$;
