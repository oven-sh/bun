// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  (IS_BUN_DEVELOPMENT?$assert(
    __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), "state") === __intrinsic__streamReadable,"$getByIdDirectPrivate($getByIdDirectPrivate(controller, \"controlledReadableStream\"), \"state\") === $streamReadable"):void 0);
  if (!__intrinsic__getByIdDirectPrivate(controller, "queue").size && __intrinsic__getByIdDirectPrivate(controller, "closeRequested"))
    __intrinsic__readableStreamClose(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
  else __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
}).$$capture_end$$;
