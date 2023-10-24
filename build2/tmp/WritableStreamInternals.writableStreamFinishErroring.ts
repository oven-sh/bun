// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === "erroring","$getByIdDirectPrivate(stream, \"state\") === \"erroring\""):void 0);
  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__writableStreamHasOperationMarkedInFlight(stream),"!$writableStreamHasOperationMarkedInFlight(stream)"):void 0);

  __intrinsic__putByIdDirectPrivate(stream, "state", "errored");

  const controller = __intrinsic__getByIdDirectPrivate(stream, "controller");
  __intrinsic__getByIdDirectPrivate(controller, "errorSteps").__intrinsic__call();

  const storedError = __intrinsic__getByIdDirectPrivate(stream, "storedError");
  const requests = __intrinsic__getByIdDirectPrivate(stream, "writeRequests");
  for (var request = requests.shift(); request; request = requests.shift())
    request.reject.__intrinsic__call(undefined, storedError);

  // TODO: is this still necessary?
  __intrinsic__putByIdDirectPrivate(stream, "writeRequests", __intrinsic__createFIFO());

  const abortRequest = __intrinsic__getByIdDirectPrivate(stream, "pendingAbortRequest");
  if (abortRequest === undefined) {
    __intrinsic__writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  __intrinsic__putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
  if (abortRequest.wasAlreadyErroring) {
    abortRequest.promise.reject.__intrinsic__call(undefined, storedError);
    __intrinsic__writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  __intrinsic__getByIdDirectPrivate(controller, "abortSteps")
    .__intrinsic__call(undefined, abortRequest.reason)
    .__intrinsic__then(
      () => {
        abortRequest.promise.resolve.__intrinsic__call();
        __intrinsic__writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
      },
      reason => {
        abortRequest.promise.reject.__intrinsic__call(undefined, reason);
        __intrinsic__writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
      },
    );
}).$$capture_end$$;
