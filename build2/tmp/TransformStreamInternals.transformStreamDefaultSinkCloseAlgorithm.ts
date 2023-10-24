// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  const readable = __intrinsic__getByIdDirectPrivate(stream, "readable");
  const controller = __intrinsic__getByIdDirectPrivate(stream, "controller");
  const readableController = __intrinsic__getByIdDirectPrivate(readable, "readableStreamController");

  const flushAlgorithm = __intrinsic__getByIdDirectPrivate(controller, "flushAlgorithm");
  (IS_BUN_DEVELOPMENT?$assert(flushAlgorithm !== undefined,"flushAlgorithm !== undefined"):void 0);
  const flushPromise = __intrinsic__getByIdDirectPrivate(controller, "flushAlgorithm").__intrinsic__call();
  __intrinsic__transformStreamDefaultControllerClearAlgorithms(controller);

  const promiseCapability = __intrinsic__newPromiseCapability(Promise);
  flushPromise.__intrinsic__then(
    () => {
      if (__intrinsic__getByIdDirectPrivate(readable, "state") === __intrinsic__streamErrored) {
        promiseCapability.reject.__intrinsic__call(undefined, __intrinsic__getByIdDirectPrivate(readable, "storedError"));
        return;
      }

      // FIXME: Update readableStreamDefaultControllerClose to make this check.
      if (__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(readableController))
        __intrinsic__readableStreamDefaultControllerClose(readableController);
      promiseCapability.resolve();
    },
    r => {
      __intrinsic__transformStreamError(__intrinsic__getByIdDirectPrivate(controller, "stream"), r);
      promiseCapability.reject.__intrinsic__call(undefined, __intrinsic__getByIdDirectPrivate(readable, "storedError"));
    },
  );
  return promiseCapability.promise;
}).$$capture_end$$;
