// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,controller,startAlgorithm,writeAlgorithm,closeAlgorithm,abortAlgorithm,highWaterMark,sizeAlgorithm,) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isWritableStream(stream),"$isWritableStream(stream)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "controller") === undefined,"$getByIdDirectPrivate(stream, \"controller\") === undefined"):void 0);

  __intrinsic__putByIdDirectPrivate(controller, "stream", stream);
  __intrinsic__putByIdDirectPrivate(stream, "controller", controller);

  __intrinsic__resetQueue(__intrinsic__getByIdDirectPrivate(controller, "queue"));

  __intrinsic__putByIdDirectPrivate(controller, "started", -1);
  __intrinsic__putByIdDirectPrivate(controller, "startAlgorithm", startAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "strategySizeAlgorithm", sizeAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "strategyHWM", highWaterMark);
  __intrinsic__putByIdDirectPrivate(controller, "writeAlgorithm", writeAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "closeAlgorithm", closeAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "abortAlgorithm", abortAlgorithm);

  const backpressure = __intrinsic__writableStreamDefaultControllerGetBackpressure(controller);
  __intrinsic__writableStreamUpdateBackpressure(stream, backpressure);

  __intrinsic__writableStreamDefaultControllerStart(controller);
}).$$capture_end$$;
