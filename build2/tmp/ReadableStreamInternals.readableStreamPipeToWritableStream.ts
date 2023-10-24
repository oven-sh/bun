// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(source,destination,preventClose,preventAbort,preventCancel,signal,) {  // const isDirectStream = !!$getByIdDirectPrivate(source, "start");

  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStream(source),"$isReadableStream(source)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isWritableStream(destination),"$isWritableStream(destination)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__isReadableStreamLocked(source),"!$isReadableStreamLocked(source)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__isWritableStreamLocked(destination),"!$isWritableStreamLocked(destination)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(signal === undefined || __intrinsic__isAbortSignal(signal),"signal === undefined || $isAbortSignal(signal)"):void 0);

  if (__intrinsic__getByIdDirectPrivate(source, "underlyingByteSource") !== undefined)
    return Promise.__intrinsic__reject("Piping to a readable bytestream is not supported");

  let pipeState: any = {
    source: source,
    destination: destination,
    preventAbort: preventAbort,
    preventCancel: preventCancel,
    preventClose: preventClose,
    signal: signal,
  };

  pipeState.reader = __intrinsic__acquireReadableStreamDefaultReader(source);
  pipeState.writer = __intrinsic__acquireWritableStreamDefaultWriter(destination);

  __intrinsic__putByIdDirectPrivate(source, "disturbed", true);

  pipeState.finalized = false;
  pipeState.shuttingDown = false;
  pipeState.promiseCapability = __intrinsic__newPromiseCapability(Promise);
  pipeState.pendingReadPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call();
  pipeState.pendingWritePromise = Promise.__intrinsic__resolve();

  if (signal !== undefined) {
    const algorithm = reason => {
      if (pipeState.finalized) return;

      __intrinsic__pipeToShutdownWithAction(
        pipeState,
        () => {
          const shouldAbortDestination =
            !pipeState.preventAbort && __intrinsic__getByIdDirectPrivate(pipeState.destination, "state") === "writable";
          const promiseDestination = shouldAbortDestination
            ? __intrinsic__writableStreamAbort(pipeState.destination, reason)
            : Promise.__intrinsic__resolve();

          const shouldAbortSource =
            !pipeState.preventCancel && __intrinsic__getByIdDirectPrivate(pipeState.source, "state") === __intrinsic__streamReadable;
          const promiseSource = shouldAbortSource
            ? __intrinsic__readableStreamCancel(pipeState.source, reason)
            : Promise.__intrinsic__resolve();

          let promiseCapability = __intrinsic__newPromiseCapability(Promise);
          let shouldWait = true;
          let handleResolvedPromise = () => {
            if (shouldWait) {
              shouldWait = false;
              return;
            }
            promiseCapability.resolve.__intrinsic__call();
          };
          let handleRejectedPromise = e => {
            promiseCapability.reject.__intrinsic__call(undefined, e);
          };
          promiseDestination.__intrinsic__then(handleResolvedPromise, handleRejectedPromise);
          promiseSource.__intrinsic__then(handleResolvedPromise, handleRejectedPromise);
          return promiseCapability.promise;
        },
        reason,
      );
    };
    if (__intrinsic__whenSignalAborted(signal, algorithm)) return pipeState.promiseCapability.promise;
  }

  __intrinsic__pipeToErrorsMustBePropagatedForward(pipeState);
  __intrinsic__pipeToErrorsMustBePropagatedBackward(pipeState);
  __intrinsic__pipeToClosingMustBePropagatedForward(pipeState);
  __intrinsic__pipeToClosingMustBePropagatedBackward(pipeState);

  __intrinsic__pipeToLoop(pipeState);

  return pipeState.promiseCapability.promise;
}).$$capture_end$$;
