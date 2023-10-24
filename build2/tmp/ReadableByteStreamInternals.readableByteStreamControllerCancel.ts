// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,reason) {  var pendingPullIntos = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos");
  var first = pendingPullIntos.peek();
  if (first) first.bytesFilled = 0;

  __intrinsic__putByIdDirectPrivate(controller, "queue", __intrinsic__newQueue());
  return __intrinsic__promiseInvokeOrNoop(__intrinsic__getByIdDirectPrivate(controller, "underlyingByteSource"), "cancel", [reason]);
}).$$capture_end$$;
