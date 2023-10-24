// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,bytesWritten) {  bytesWritten = __intrinsic__toNumber(bytesWritten);

  if (bytesWritten !== bytesWritten || bytesWritten === Infinity || bytesWritten < 0)
    __intrinsic__throwRangeError("bytesWritten has an incorrect value");

  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").isNotEmpty(),"$getByIdDirectPrivate(controller, \"pendingPullIntos\").isNotEmpty()"):void 0);

  __intrinsic__readableByteStreamControllerRespondInternal(controller, bytesWritten);
}).$$capture_end$$;
