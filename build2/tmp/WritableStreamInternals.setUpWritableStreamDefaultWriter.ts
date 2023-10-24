// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer,stream) {  if (__intrinsic__isWritableStreamLocked(stream)) __intrinsic__throwTypeError("WritableStream is locked");

  __intrinsic__putByIdDirectPrivate(writer, "stream", stream);
  __intrinsic__putByIdDirectPrivate(stream, "writer", writer);

  const readyPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  const closedPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  __intrinsic__putByIdDirectPrivate(writer, "readyPromise", readyPromiseCapability);
  __intrinsic__putByIdDirectPrivate(writer, "closedPromise", closedPromiseCapability);

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  if (state === "writable") {
    if (__intrinsic__writableStreamCloseQueuedOrInFlight(stream) || !__intrinsic__getByIdDirectPrivate(stream, "backpressure"))
      readyPromiseCapability.resolve.__intrinsic__call();
  } else if (state === "erroring") {
    readyPromiseCapability.reject.__intrinsic__call(undefined, __intrinsic__getByIdDirectPrivate(stream, "storedError"));
    __intrinsic__markPromiseAsHandled(readyPromiseCapability.promise);
  } else if (state === "closed") {
    readyPromiseCapability.resolve.__intrinsic__call();
    closedPromiseCapability.resolve.__intrinsic__call();
  } else {
    (IS_BUN_DEVELOPMENT?$assert(state === "errored","state === \"errored\""):void 0);
    const storedError = __intrinsic__getByIdDirectPrivate(stream, "storedError");
    readyPromiseCapability.reject.__intrinsic__call(undefined, storedError);
    __intrinsic__markPromiseAsHandled(readyPromiseCapability.promise);
    closedPromiseCapability.reject.__intrinsic__call(undefined, storedError);
    __intrinsic__markPromiseAsHandled(closedPromiseCapability.promise);
  }
}).$$capture_end$$;
