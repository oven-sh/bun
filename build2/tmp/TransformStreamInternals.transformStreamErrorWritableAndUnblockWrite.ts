// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,e) {  __intrinsic__transformStreamDefaultControllerClearAlgorithms(__intrinsic__getByIdDirectPrivate(stream, "controller"));

  const writable = __intrinsic__getByIdDirectPrivate(stream, "internalWritable");
  __intrinsic__writableStreamDefaultControllerErrorIfNeeded(__intrinsic__getByIdDirectPrivate(writable, "controller"), e);

  if (__intrinsic__getByIdDirectPrivate(stream, "backpressure")) __intrinsic__transformStreamSetBackpressure(stream, false);
}).$$capture_end$$;
