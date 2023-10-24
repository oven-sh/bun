// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamDefaultController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isTransformStreamDefaultController(this))
    throw __intrinsic__makeThisTypeError("TransformStreamDefaultController", "enqueue");

  const stream = __intrinsic__getByIdDirectPrivate(this, "stream");
  const readable = __intrinsic__getByIdDirectPrivate(stream, "readable");
  const readableController = __intrinsic__getByIdDirectPrivate(readable, "readableStreamController");

  return __intrinsic__readableStreamDefaultControllerGetDesiredSize(readableController);
}).$$capture_end$$;
