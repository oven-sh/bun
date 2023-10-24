// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");
  const state = __intrinsic__getByIdDirectPrivate(stream, "state");

  if (state === __intrinsic__streamErrored) return null;
  if (state === __intrinsic__streamClosed) return 0;

  return __intrinsic__getByIdDirectPrivate(controller, "strategy").highWaterMark - __intrinsic__getByIdDirectPrivate(controller, "queue").size;
}).$$capture_end$$;
