// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState) {  (IS_BUN_DEVELOPMENT?$assert(!pipeState.shuttingDown,"!pipeState.shuttingDown"):void 0);

  pipeState.pendingReadPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  __intrinsic__getByIdDirectPrivate(pipeState.writer, "readyPromise").promise.__intrinsic__then(
    () => {
      if (pipeState.shuttingDown) {
        pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call(undefined, false);
        return;
      }

      __intrinsic__readableStreamDefaultReaderRead(pipeState.reader).__intrinsic__then(
        result => {
          const canWrite = !result.done && __intrinsic__getByIdDirectPrivate(pipeState.writer, "stream") !== undefined;
          pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call(undefined, canWrite);
          if (!canWrite) return;

          pipeState.pendingWritePromise = __intrinsic__writableStreamDefaultWriterWrite(pipeState.writer, result.value);
        },
        e => {
          pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call(undefined, false);
        },
      );
    },
    e => {
      pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call(undefined, false);
    },
  );
  return pipeState.pendingReadPromiseCapability.promise;
}).$$capture_end$$;
