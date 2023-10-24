// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,chunk) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");
  const readable = __intrinsic__getByIdDirectPrivate(stream, "readable");
  const readableController = __intrinsic__getByIdDirectPrivate(readable, "readableStreamController");

  (IS_BUN_DEVELOPMENT?$assert(readableController !== undefined,"readableController !== undefined"):void 0);
  if (!__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(readableController))
    __intrinsic__throwTypeError("TransformStream.readable cannot close or enqueue");

  try {
    __intrinsic__readableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (e) {
    __intrinsic__transformStreamErrorWritableAndUnblockWrite(stream, e);
    throw __intrinsic__getByIdDirectPrivate(readable, "storedError");
  }

  const backpressure = !__intrinsic__readableStreamDefaultControllerShouldCallPull(readableController);
  if (backpressure !== __intrinsic__getByIdDirectPrivate(stream, "backpressure")) {
    (IS_BUN_DEVELOPMENT?$assert(backpressure,"backpressure"):void 0);
    __intrinsic__transformStreamSetBackpressure(stream, true);
  }
}).$$capture_end$$;
