// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer,error) {  let closedPromiseCapability = __intrinsic__getByIdDirectPrivate(writer, "closedPromise");
  let closedPromise = closedPromiseCapability.promise;

  if ((__intrinsic__getPromiseInternalField(closedPromise, __intrinsic__promiseFieldFlags) & __intrinsic__promiseStateMask) !== __intrinsic__promiseStatePending) {
    closedPromiseCapability = __intrinsic__newPromiseCapability(Promise);
    closedPromise = closedPromiseCapability.promise;
    __intrinsic__putByIdDirectPrivate(writer, "closedPromise", closedPromiseCapability);
  }

  closedPromiseCapability.reject.__intrinsic__call(undefined, error);
  __intrinsic__markPromiseAsHandled(closedPromise);
}).$$capture_end$$;
