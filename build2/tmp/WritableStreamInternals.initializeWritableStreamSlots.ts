// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingSink) {  __intrinsic__putByIdDirectPrivate(stream, "state", "writable");
  __intrinsic__putByIdDirectPrivate(stream, "storedError", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "writer", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "controller", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "inFlightWriteRequest", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "closeRequest", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "inFlightCloseRequest", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "writeRequests", __intrinsic__createFIFO());
  __intrinsic__putByIdDirectPrivate(stream, "backpressure", false);
  __intrinsic__putByIdDirectPrivate(stream, "underlyingSink", underlyingSink);
}).$$capture_end$$;
