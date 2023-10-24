// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  __intrinsic__readableByteStreamControllerInvalidateBYOBRequest(controller);
  var existing = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos");
  if (existing !== undefined) {
    existing.clear();
  } else {
    __intrinsic__putByIdDirectPrivate(controller, "pendingPullIntos", __intrinsic__createFIFO());
  }
}).$$capture_end$$;
