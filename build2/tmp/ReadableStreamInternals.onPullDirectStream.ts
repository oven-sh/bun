// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  var stream = controller.__intrinsic__controlledReadableStream;
  if (!stream || __intrinsic__getByIdDirectPrivate(stream, "state") !== __intrinsic__streamReadable) return;

  // pull is in progress
  // this is a recursive call
  // ignore it
  if (controller._deferClose === -1) {
    return;
  }

  controller._deferClose = -1;
  controller._deferFlush = -1;
  var deferClose;
  var deferFlush;

  var asyncContext = stream.__intrinsic__asyncContext;
  if (asyncContext) {
    var prev = __intrinsic__getInternalField(__intrinsic__asyncContext, 0);
    __intrinsic__putInternalField(__intrinsic__asyncContext, 0, asyncContext);
  }

  // Direct streams allow $pull to be called multiple times, unlike the spec.
  // Backpressure is handled by the destination, not by the underlying source.
  // In this case, we rely on the heuristic that repeatedly draining in the same tick
  // is bad for performance
  // this code is only run when consuming a direct stream from JS
  // without the HTTP server or anything else
  try {
    var result = controller.__intrinsic__underlyingSource.pull(controller);

    if (result && __intrinsic__isPromise(result)) {
      if (controller._handleError === undefined) {
        controller._handleError = __intrinsic__handleDirectStreamErrorReject.bind(controller);
      }

      Promise.prototype.catch.__intrinsic__call(result, controller._handleError);
    }
  } catch (e) {
    return __intrinsic__handleDirectStreamErrorReject.__intrinsic__call(controller, e);
  } finally {
    deferClose = controller._deferClose;
    deferFlush = controller._deferFlush;
    controller._deferFlush = controller._deferClose = 0;

    if (asyncContext) {
      __intrinsic__putInternalField(__intrinsic__asyncContext, 0, prev);
    }
  }

  var promiseToReturn;

  if (controller._pendingRead === undefined) {
    controller._pendingRead = promiseToReturn = __intrinsic__newPromise();
  } else {
    promiseToReturn = __intrinsic__readableStreamAddReadRequest(stream);
  }

  // they called close during $pull()
  // we delay that
  if (deferClose === 1) {
    var reason = controller._deferCloseReason;
    controller._deferCloseReason = undefined;
    __intrinsic__onCloseDirectStream.__intrinsic__call(controller, reason);
    return promiseToReturn;
  }

  // not done, but they called flush()
  if (deferFlush === 1) {
    __intrinsic__onFlushDirectStream.__intrinsic__call(controller);
  }

  return promiseToReturn;
}).$$capture_end$$;
