// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,chunk) {  const promiseCapability = __intrinsic__newPromiseCapability(Promise);

  const transformPromise = __intrinsic__getByIdDirectPrivate(controller, "transformAlgorithm").__intrinsic__call(undefined, chunk);
  transformPromise.__intrinsic__then(
    () => {
      promiseCapability.resolve();
    },
    r => {
      __intrinsic__transformStreamError(__intrinsic__getByIdDirectPrivate(controller, "stream"), r);
      promiseCapability.reject.__intrinsic__call(undefined, r);
    },
  );
  return promiseCapability.promise;
}).$$capture_end$$;
