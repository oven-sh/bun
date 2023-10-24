// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "closeRequested"),"!$getByIdDirectPrivate(controller, \"closeRequested\")"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(
    __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), "state") === __intrinsic__streamReadable,"$getByIdDirectPrivate($getByIdDirectPrivate(controller, \"controlledReadableStream\"), \"state\") === $streamReadable"):void 0);

  if (__intrinsic__getByIdDirectPrivate(controller, "queue").size > 0) {
    __intrinsic__putByIdDirectPrivate(controller, "closeRequested", true);
    return;
  }

  var first = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos")?.peek();
  if (first) {
    if (first.bytesFilled > 0) {
      const e = __intrinsic__makeTypeError("Close requested while there remain pending bytes");
      __intrinsic__readableByteStreamControllerError(controller, e);
      throw e;
    }
  }

  __intrinsic__readableStreamClose(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
}).$$capture_end$$;
