// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,chunk) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");
  // this is checked by callers
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(controller),"$readableStreamDefaultControllerCanCloseOrEnqueue(controller)"):void 0);

  if (
    __intrinsic__isReadableStreamLocked(stream) &&
    __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty()
  ) {
    __intrinsic__readableStreamFulfillReadRequest(stream, chunk, false);
    __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
    return;
  }

  try {
    let chunkSize = 1;
    if (__intrinsic__getByIdDirectPrivate(controller, "strategy").size !== undefined)
      chunkSize = __intrinsic__getByIdDirectPrivate(controller, "strategy").size(chunk);
    __intrinsic__enqueueValueWithSize(__intrinsic__getByIdDirectPrivate(controller, "queue"), chunk, chunkSize);
  } catch (error) {
    __intrinsic__readableStreamDefaultControllerError(controller, error);
    throw error;
  }
  __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
}).$$capture_end$$;
