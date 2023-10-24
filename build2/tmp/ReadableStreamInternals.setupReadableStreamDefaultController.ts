// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingSource,size,highWaterMark,startMethod,pullMethod,cancelMethod,) {  const controller = new ReadableStreamDefaultController(
    stream,
    underlyingSource,
    size,
    highWaterMark,
    __intrinsic__isReadableStream,
  );

  var asyncContext = stream.__intrinsic__asyncContext;
  const pullAlgorithm = () => __intrinsic__promiseInvokeOrNoopMethod(underlyingSource, pullMethod, [controller]);
  const cancelAlgorithm = asyncContext
    ? reason => {
        var prev = __intrinsic__getInternalField(__intrinsic__asyncContext, 0);
        __intrinsic__putInternalField(__intrinsic__asyncContext, 0, asyncContext);
        // this does not throw, but can returns a rejected promise
        var result = __intrinsic__promiseInvokeOrNoopMethod(underlyingSource, cancelMethod, [reason]);
        __intrinsic__putInternalField(__intrinsic__asyncContext, 0, prev);
        return result;
      }
    : reason => __intrinsic__promiseInvokeOrNoopMethod(underlyingSource, cancelMethod, [reason]);

  __intrinsic__putByIdDirectPrivate(controller, "pullAlgorithm", pullAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "cancelAlgorithm", cancelAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "pull", __intrinsic__readableStreamDefaultControllerPull);
  __intrinsic__putByIdDirectPrivate(controller, "cancel", __intrinsic__readableStreamDefaultControllerCancel);
  __intrinsic__putByIdDirectPrivate(stream, "readableStreamController", controller);

  __intrinsic__readableStreamDefaultControllerStart(controller);
}).$$capture_end$$;
