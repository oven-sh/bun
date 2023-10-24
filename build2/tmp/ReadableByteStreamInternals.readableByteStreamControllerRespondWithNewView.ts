// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,view) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").isNotEmpty(),"$getByIdDirectPrivate(controller, \"pendingPullIntos\").isNotEmpty()"):void 0);

  let firstDescriptor = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").peek();

  if (firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== view.byteOffset)
    __intrinsic__throwRangeError("Invalid value for view.byteOffset");

  if (firstDescriptor.byteLength !== view.byteLength) __intrinsic__throwRangeError("Invalid value for view.byteLength");

  firstDescriptor.buffer = view.buffer;
  __intrinsic__readableByteStreamControllerRespondInternal(controller, view.byteLength);
}).$$capture_end$$;
