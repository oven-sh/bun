// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(startAlgorithm,transformAlgorithm,flushAlgorithm,writableHighWaterMark,writableSizeAlgorithm,readableHighWaterMark,readableSizeAlgorithm,) {  if (writableHighWaterMark === undefined) writableHighWaterMark = 1;
  if (writableSizeAlgorithm === undefined) writableSizeAlgorithm = () => 1;
  if (readableHighWaterMark === undefined) readableHighWaterMark = 0;
  if (readableSizeAlgorithm === undefined) readableSizeAlgorithm = () => 1;
  (IS_BUN_DEVELOPMENT?$assert(writableHighWaterMark >= 0,"writableHighWaterMark >= 0"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(readableHighWaterMark >= 0,"readableHighWaterMark >= 0"):void 0);

  const transform = {};
  __intrinsic__putByIdDirectPrivate(transform, "TransformStream", true);

  const stream = new TransformStream(transform);
  const startPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  __intrinsic__initializeTransformStream(
    stream,
    startPromiseCapability.promise,
    writableHighWaterMark,
    writableSizeAlgorithm,
    readableHighWaterMark,
    readableSizeAlgorithm,
  );

  const controller = new TransformStreamDefaultController();
  __intrinsic__setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);

  startAlgorithm().__intrinsic__then(
    () => {
      startPromiseCapability.resolve.__intrinsic__call();
    },
    error => {
      startPromiseCapability.reject.__intrinsic__call(undefined, error);
    },
  );

  return stream;
}).$$capture_end$$;
