// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,error) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");
  if (__intrinsic__getByIdDirectPrivate(stream, "state") !== __intrinsic__streamReadable) return;
  __intrinsic__putByIdDirectPrivate(controller, "queue", __intrinsic__newQueue());

  __intrinsic__readableStreamError(stream, error);
}).$$capture_end$$;
