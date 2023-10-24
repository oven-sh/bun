// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer,error) {  let readyPromiseCapability = __intrinsic__getByIdDirectPrivate(writer, "readyPromise");
  let readyPromise = readyPromiseCapability.promise;

  if ((__intrinsic__getPromiseInternalField(readyPromise, __intrinsic__promiseFieldFlags) & __intrinsic__promiseStateMask) !== __intrinsic__promiseStatePending) {
    readyPromiseCapability = __intrinsic__newPromiseCapability(Promise);
    readyPromise = readyPromiseCapability.promise;
    __intrinsic__putByIdDirectPrivate(writer, "readyPromise", readyPromiseCapability);
  }

  readyPromiseCapability.reject.__intrinsic__call(undefined, error);
  __intrinsic__markPromiseAsHandled(readyPromise);
}).$$capture_end$$;
