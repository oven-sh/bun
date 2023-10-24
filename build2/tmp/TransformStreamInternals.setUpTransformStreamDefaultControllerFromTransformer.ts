// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,transformer,transformerDict) {  const controller = new TransformStreamDefaultController();
  let transformAlgorithm = chunk => {
    try {
      __intrinsic__transformStreamDefaultControllerEnqueue(controller, chunk);
    } catch (e) {
      return Promise.__intrinsic__reject(e);
    }
    return Promise.__intrinsic__resolve();
  };
  let flushAlgorithm = () => {
    return Promise.__intrinsic__resolve();
  };

  if ("transform" in transformerDict)
    transformAlgorithm = chunk => {
      return __intrinsic__promiseInvokeOrNoopMethod(transformer, transformerDict["transform"], [chunk, controller]);
    };

  if ("flush" in transformerDict) {
    flushAlgorithm = () => {
      return __intrinsic__promiseInvokeOrNoopMethod(transformer, transformerDict["flush"], [controller]);
    };
  }

  __intrinsic__setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);
}).$$capture_end$$;
