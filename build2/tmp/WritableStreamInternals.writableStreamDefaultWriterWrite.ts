// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer,chunk) {  const stream = __intrinsic__getByIdDirectPrivate(writer, "stream");
  (IS_BUN_DEVELOPMENT?$assert(stream !== undefined,"stream !== undefined"):void 0);

  const controller = __intrinsic__getByIdDirectPrivate(stream, "controller");
  (IS_BUN_DEVELOPMENT?$assert(controller !== undefined,"controller !== undefined"):void 0);
  const chunkSize = __intrinsic__writableStreamDefaultControllerGetChunkSize(controller, chunk);

  if (stream !== __intrinsic__getByIdDirectPrivate(writer, "stream"))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("writer is not stream's writer"));

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  if (state === "errored") return Promise.__intrinsic__reject(__intrinsic__getByIdDirectPrivate(stream, "storedError"));

  if (__intrinsic__writableStreamCloseQueuedOrInFlight(stream) || state === "closed")
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("stream is closing or closed"));

  if (__intrinsic__writableStreamCloseQueuedOrInFlight(stream) || state === "closed")
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("stream is closing or closed"));

  if (state === "erroring") return Promise.__intrinsic__reject(__intrinsic__getByIdDirectPrivate(stream, "storedError"));

  (IS_BUN_DEVELOPMENT?$assert(state === "writable","state === \"writable\""):void 0);

  const promise = __intrinsic__writableStreamAddWriteRequest(stream);
  __intrinsic__writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}).$$capture_end$$;
