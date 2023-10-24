// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,e) {  (IS_BUN_DEVELOPMENT?$assert(
    __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), "state") === __intrinsic__streamReadable,"$getByIdDirectPrivate($getByIdDirectPrivate(controller, \"controlledReadableStream\"), \"state\") === $streamReadable"):void 0);
  __intrinsic__readableByteStreamControllerClearPendingPullIntos(controller);
  __intrinsic__putByIdDirectPrivate(controller, "queue", __intrinsic__newQueue());
  __intrinsic__readableStreamError(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), e);
}).$$capture_end$$;
