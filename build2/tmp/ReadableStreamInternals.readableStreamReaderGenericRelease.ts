// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reader) {  (IS_BUN_DEVELOPMENT?$assert(!!__intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream"),"!!$getByIdDirectPrivate(reader, \"ownerReadableStream\")"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream"), "reader") === reader,"$getByIdDirectPrivate($getByIdDirectPrivate(reader, \"ownerReadableStream\"), \"reader\") === reader"):void 0);

  if (__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream"), "state") === __intrinsic__streamReadable)
    __intrinsic__getByIdDirectPrivate(reader, "closedPromiseCapability").reject.__intrinsic__call(
      undefined,
      __intrinsic__makeTypeError("releasing lock of reader whose stream is still in readable state"),
    );
  else
    __intrinsic__putByIdDirectPrivate(reader, "closedPromiseCapability", {
      promise: __intrinsic__newHandledRejectedPromise(__intrinsic__makeTypeError("reader released lock")),
    });

  const promise = __intrinsic__getByIdDirectPrivate(reader, "closedPromiseCapability").promise;
  __intrinsic__markPromiseAsHandled(promise);
  __intrinsic__putByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream"), "reader", undefined);
  __intrinsic__putByIdDirectPrivate(reader, "ownerReadableStream", undefined);
}).$$capture_end$$;
