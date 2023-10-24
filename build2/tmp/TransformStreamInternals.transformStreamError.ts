// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,e) {  const readable = __intrinsic__getByIdDirectPrivate(stream, "readable");
  const readableController = __intrinsic__getByIdDirectPrivate(readable, "readableStreamController");
  __intrinsic__readableStreamDefaultControllerError(readableController, e);

  __intrinsic__transformStreamErrorWritableAndUnblockWrite(stream, e);
}).$$capture_end$$;
