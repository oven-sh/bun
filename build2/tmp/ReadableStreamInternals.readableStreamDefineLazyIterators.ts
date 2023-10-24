// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(prototype) {  var asyncIterator = globalThis.Symbol.asyncIterator;

  var ReadableStreamAsyncIterator = async function* ReadableStreamAsyncIterator(stream, preventCancel) {
    var reader = stream.getReader();
    var deferredError;
    try {
      while (true) {
        var done, value;
        const firstResult = reader.readMany();
        if (__intrinsic__isPromise(firstResult)) {
          ({ done, value } = await firstResult);
        } else {
          ({ done, value } = firstResult);
        }

        if (done) {
          return;
        }
        yield* value;
      }
    } catch (e) {
      deferredError = e;
    } finally {
      reader.releaseLock();

      if (!preventCancel) {
        stream.cancel(deferredError);
      }

      if (deferredError) {
        throw deferredError;
      }
    }
  };
  var createAsyncIterator = function asyncIterator() {
    return ReadableStreamAsyncIterator(this, false);
  };
  var createValues = function values({ preventCancel = false } = { preventCancel: false }) {
    return ReadableStreamAsyncIterator(this, preventCancel);
  };
  __intrinsic__Object.__intrinsic__defineProperty(prototype, asyncIterator, { value: createAsyncIterator });
  __intrinsic__Object.__intrinsic__defineProperty(prototype, "values", { value: createValues });
  return prototype;
}).$$capture_end$$;
