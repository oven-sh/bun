// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,bytesWritten) {  let firstDescriptor = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").peek();
  let stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");

  if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamClosed) {
    if (bytesWritten !== 0) __intrinsic__throwTypeError("bytesWritten is different from 0 even though stream is closed");
    __intrinsic__readableByteStreamControllerRespondInClosedState(controller, firstDescriptor);
  } else {
    (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable,"$getByIdDirectPrivate(stream, \"state\") === $streamReadable"):void 0);
    __intrinsic__readableByteStreamControllerRespondInReadableState(controller, bytesWritten, firstDescriptor);
  }
}).$$capture_end$$;
