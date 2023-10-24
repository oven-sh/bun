// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");
  const readable = __intrinsic__getByIdDirectPrivate(stream, "readable");
  const readableController = __intrinsic__getByIdDirectPrivate(readable, "readableStreamController");

  // FIXME: Update readableStreamDefaultControllerClose to make this check.
  if (__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(readableController))
    __intrinsic__readableStreamDefaultControllerClose(readableController);
  const error = __intrinsic__makeTypeError("the stream has been terminated");
  __intrinsic__transformStreamErrorWritableAndUnblockWrite(stream, error);
}).$$capture_end$$;
