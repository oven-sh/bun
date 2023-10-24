// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingSink,underlyingSinkDict,highWaterMark,sizeAlgorithm,) {  // @ts-ignore
  const controller = new __intrinsic__WritableStreamDefaultController();

  let startAlgorithm: (...args: any[]) => any = () => {};
  let writeAlgorithm: (...args: any[]) => any = () => {
    return Promise.__intrinsic__resolve();
  };
  let closeAlgorithm: (...args: any[]) => any = () => {
    return Promise.__intrinsic__resolve();
  };
  let abortAlgorithm: (...args: any[]) => any = () => {
    return Promise.__intrinsic__resolve();
  };

  if ("start" in underlyingSinkDict) {
    const startMethod = underlyingSinkDict["start"];
    startAlgorithm = () => __intrinsic__promiseInvokeOrNoopMethodNoCatch(underlyingSink, startMethod, [controller]);
  }
  if ("write" in underlyingSinkDict) {
    const writeMethod = underlyingSinkDict["write"];
    writeAlgorithm = chunk => __intrinsic__promiseInvokeOrNoopMethod(underlyingSink, writeMethod, [chunk, controller]);
  }
  if ("close" in underlyingSinkDict) {
    const closeMethod = underlyingSinkDict["close"];
    closeAlgorithm = () => __intrinsic__promiseInvokeOrNoopMethod(underlyingSink, closeMethod, []);
  }
  if ("abort" in underlyingSinkDict) {
    const abortMethod = underlyingSinkDict["abort"];
    abortAlgorithm = reason => __intrinsic__promiseInvokeOrNoopMethod(underlyingSink, abortMethod, [reason]);
  }

  __intrinsic__setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
}).$$capture_end$$;
