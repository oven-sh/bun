// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(controller),"$readableStreamDefaultControllerCanCloseOrEnqueue(controller)"):void 0);
  __intrinsic__putByIdDirectPrivate(controller, "closeRequested", true);
  if (__intrinsic__getByIdDirectPrivate(controller, "queue")?.content?.isEmpty())
    __intrinsic__readableStreamClose(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
}).$$capture_end$$;
