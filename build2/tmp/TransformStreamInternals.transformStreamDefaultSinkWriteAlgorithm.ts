// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,chunk) {  const writable = __intrinsic__getByIdDirectPrivate(stream, "internalWritable");

  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(writable, "state") === "writable","$getByIdDirectPrivate(writable, \"state\") === \"writable\""):void 0);

  const controller = __intrinsic__getByIdDirectPrivate(stream, "controller");

  if (__intrinsic__getByIdDirectPrivate(stream, "backpressure")) {
    const promiseCapability = __intrinsic__newPromiseCapability(Promise);

    const backpressureChangePromise = __intrinsic__getByIdDirectPrivate(stream, "backpressureChangePromise");
    (IS_BUN_DEVELOPMENT?$assert(backpressureChangePromise !== undefined,"backpressureChangePromise !== undefined"):void 0);
    backpressureChangePromise.promise.__intrinsic__then(
      () => {
        const state = __intrinsic__getByIdDirectPrivate(writable, "state");
        if (state === "erroring") {
          promiseCapability.reject.__intrinsic__call(undefined, __intrinsic__getByIdDirectPrivate(writable, "storedError"));
          return;
        }

        (IS_BUN_DEVELOPMENT?$assert(state === "writable","state === \"writable\""):void 0);
        __intrinsic__transformStreamDefaultControllerPerformTransform(controller, chunk).__intrinsic__then(
          () => {
            promiseCapability.resolve();
          },
          e => {
            promiseCapability.reject.__intrinsic__call(undefined, e);
          },
        );
      },
      e => {
        promiseCapability.reject.__intrinsic__call(undefined, e);
      },
    );

    return promiseCapability.promise;
  }
  return __intrinsic__transformStreamDefaultControllerPerformTransform(controller, chunk);
}).$$capture_end$$;
