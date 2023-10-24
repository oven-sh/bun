// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  let transformer = arguments[0];

  // This is the path for CreateTransformStream.
  if (__intrinsic__isObject(transformer) && __intrinsic__getByIdDirectPrivate(transformer, "TransformStream")) return this;

  let writableStrategy = arguments[1];
  let readableStrategy = arguments[2];

  if (transformer === undefined) transformer = null;

  if (readableStrategy === undefined) readableStrategy = {};

  if (writableStrategy === undefined) writableStrategy = {};

  let transformerDict = {};
  if (transformer !== null) {
    if ("start" in transformer) {
      transformerDict["start"] = transformer["start"];
      if (typeof transformerDict["start"] !== "function") __intrinsic__throwTypeError("transformer.start should be a function");
    }
    if ("transform" in transformer) {
      transformerDict["transform"] = transformer["transform"];
      if (typeof transformerDict["transform"] !== "function")
        __intrinsic__throwTypeError("transformer.transform should be a function");
    }
    if ("flush" in transformer) {
      transformerDict["flush"] = transformer["flush"];
      if (typeof transformerDict["flush"] !== "function") __intrinsic__throwTypeError("transformer.flush should be a function");
    }

    if ("readableType" in transformer) __intrinsic__throwRangeError("TransformStream transformer has a readableType");
    if ("writableType" in transformer) __intrinsic__throwRangeError("TransformStream transformer has a writableType");
  }

  const readableHighWaterMark = __intrinsic__extractHighWaterMark(readableStrategy, 0);
  const readableSizeAlgorithm = __intrinsic__extractSizeAlgorithm(readableStrategy);

  const writableHighWaterMark = __intrinsic__extractHighWaterMark(writableStrategy, 1);
  const writableSizeAlgorithm = __intrinsic__extractSizeAlgorithm(writableStrategy);

  const startPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  __intrinsic__initializeTransformStream(
    this,
    startPromiseCapability.promise,
    writableHighWaterMark,
    writableSizeAlgorithm,
    readableHighWaterMark,
    readableSizeAlgorithm,
  );
  __intrinsic__setUpTransformStreamDefaultControllerFromTransformer(this, transformer, transformerDict);

  if ("start" in transformerDict) {
    const controller = __intrinsic__getByIdDirectPrivate(this, "controller");
    const startAlgorithm = () => __intrinsic__promiseInvokeOrNoopMethodNoCatch(transformer, transformerDict["start"], [controller]);
    startAlgorithm().__intrinsic__then(
      () => {
        // FIXME: We probably need to resolve start promise with the result of the start algorithm.
        startPromiseCapability.resolve.__intrinsic__call();
      },
      error => {
        startPromiseCapability.reject.__intrinsic__call(undefined, error);
      },
    );
  } else startPromiseCapability.resolve.__intrinsic__call();

  return this;
}).$$capture_end$$;
