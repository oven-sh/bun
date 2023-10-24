// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamDefaultController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(chunk) {  if (!__intrinsic__isReadableStreamDefaultController(this)) throw __intrinsic__makeThisTypeError("ReadableStreamDefaultController", "enqueue");

  if (!__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(this))
    __intrinsic__throwTypeError("ReadableStreamDefaultController is not in a state where chunk can be enqueued");

  return __intrinsic__readableStreamDefaultControllerEnqueue(this, chunk);
}).$$capture_end$$;
