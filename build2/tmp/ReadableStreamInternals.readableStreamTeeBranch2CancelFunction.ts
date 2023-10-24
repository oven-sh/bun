// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(teeState,stream) {  return function (r) {
    teeState.canceled2 = true;
    teeState.reason2 = r;
    if (teeState.canceled1) {
      __intrinsic__readableStreamCancel(stream, [teeState.reason1, teeState.reason2]).__intrinsic__then(
        teeState.cancelPromiseCapability.__intrinsic__resolve,
        teeState.cancelPromiseCapability.__intrinsic__reject,
      );
    }
    return teeState.cancelPromiseCapability.promise;
  };
}).$$capture_end$$;
