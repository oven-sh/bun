// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,pullIntoDescriptor) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") !== __intrinsic__streamErrored,"$getByIdDirectPrivate(stream, \"state\") !== $streamErrored"):void 0);
  let done = false;
  if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamClosed) {
    (IS_BUN_DEVELOPMENT?$assert(!pullIntoDescriptor.bytesFilled,"!pullIntoDescriptor.bytesFilled"):void 0);
    done = true;
  }
  let filledView = __intrinsic__readableByteStreamControllerConvertDescriptor(pullIntoDescriptor);
  if (pullIntoDescriptor.readerType === "default") __intrinsic__readableStreamFulfillReadRequest(stream, filledView, done);
  else {
    (IS_BUN_DEVELOPMENT?$assert(pullIntoDescriptor.readerType === "byob","pullIntoDescriptor.readerType === \"byob\""):void 0);
    __intrinsic__readableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}).$$capture_end$$;
