// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reader,stream) {  __intrinsic__putByIdDirectPrivate(reader, "ownerReadableStream", stream);
  __intrinsic__putByIdDirectPrivate(stream, "reader", reader);
  if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable)
    __intrinsic__putByIdDirectPrivate(reader, "closedPromiseCapability", __intrinsic__newPromiseCapability(Promise));
  else if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamClosed)
    __intrinsic__putByIdDirectPrivate(reader, "closedPromiseCapability", {
      promise: Promise.__intrinsic__resolve(),
    });
  else {
    (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamErrored,"$getByIdDirectPrivate(stream, \"state\") === $streamErrored"):void 0);
    __intrinsic__putByIdDirectPrivate(reader, "closedPromiseCapability", {
      promise: __intrinsic__newHandledRejectedPromise(__intrinsic__getByIdDirectPrivate(stream, "storedError")),
    });
  }
}).$$capture_end$$;
