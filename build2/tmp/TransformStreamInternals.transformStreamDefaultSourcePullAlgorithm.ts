// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "backpressure"),"$getByIdDirectPrivate(stream, \"backpressure\")"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "backpressureChangePromise") !== undefined,"$getByIdDirectPrivate(stream, \"backpressureChangePromise\") !== undefined"):void 0);

  __intrinsic__transformStreamSetBackpressure(stream, false);

  return __intrinsic__getByIdDirectPrivate(stream, "backpressureChangePromise").promise;
}).$$capture_end$$;
