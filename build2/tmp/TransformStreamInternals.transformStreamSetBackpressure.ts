// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,backpressure) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "backpressure") !== backpressure,"$getByIdDirectPrivate(stream, \"backpressure\") !== backpressure"):void 0);

  const backpressureChangePromise = __intrinsic__getByIdDirectPrivate(stream, "backpressureChangePromise");
  if (backpressureChangePromise !== undefined) backpressureChangePromise.resolve.__intrinsic__call();

  __intrinsic__putByIdDirectPrivate(stream, "backpressureChangePromise", __intrinsic__newPromiseCapability(Promise));
  __intrinsic__putByIdDirectPrivate(stream, "backpressure", backpressure);
}).$$capture_end$$;
