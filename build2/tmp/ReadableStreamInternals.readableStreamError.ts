// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,error) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStream(stream),"$isReadableStream(stream)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable,"$getByIdDirectPrivate(stream, \"state\") === $streamReadable"):void 0);
  __intrinsic__putByIdDirectPrivate(stream, "state", __intrinsic__streamErrored);
  __intrinsic__putByIdDirectPrivate(stream, "storedError", error);

  const reader = __intrinsic__getByIdDirectPrivate(stream, "reader");

  if (!reader) return;

  if (__intrinsic__isReadableStreamDefaultReader(reader)) {
    const requests = __intrinsic__getByIdDirectPrivate(reader, "readRequests");
    __intrinsic__putByIdDirectPrivate(reader, "readRequests", __intrinsic__createFIFO());
    for (var request = requests.shift(); request; request = requests.shift()) __intrinsic__rejectPromise(request, error);
  } else {
    (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStreamBYOBReader(reader),"$isReadableStreamBYOBReader(reader)"):void 0);
    const requests = __intrinsic__getByIdDirectPrivate(reader, "readIntoRequests");
    __intrinsic__putByIdDirectPrivate(reader, "readIntoRequests", __intrinsic__createFIFO());
    for (var request = requests.shift(); request; request = requests.shift()) __intrinsic__rejectPromise(request, error);
  }

  __intrinsic__getByIdDirectPrivate(reader, "closedPromiseCapability").reject.__intrinsic__call(undefined, error);
  const promise = __intrinsic__getByIdDirectPrivate(reader, "closedPromiseCapability").promise;
  __intrinsic__markPromiseAsHandled(promise);
}).$$capture_end$$;
