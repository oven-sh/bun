// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingSource) {  var sink = new Bun.ArrayBufferSink();
  __intrinsic__putByIdDirectPrivate(stream, "underlyingSource", undefined);
  var highWaterMark = __intrinsic__getByIdDirectPrivate(stream, "highWaterMark");
  sink.start(highWaterMark ? { highWaterMark } : {});
  var capability = __intrinsic__newPromiseCapability(Promise);
  var ended = false;
  var pull = underlyingSource.pull;
  var close = underlyingSource.close;

  var controller = {
    start() {},
    close(reason) {
      if (!ended) {
        ended = true;
        if (close) {
          close();
        }

        __intrinsic__fulfillPromise(capability.promise, sink.end());
      }
    },
    end() {
      if (!ended) {
        ended = true;
        if (close) {
          close();
        }
        __intrinsic__fulfillPromise(capability.promise, sink.end());
      }
    },
    flush() {
      return 0;
    },
    write: sink.write.bind(sink),
  };

  var didError = false;
  try {
    const firstPull = pull(controller);
    if (firstPull && __intrinsic__isObject(firstPull) && __intrinsic__isPromise(firstPull)) {
      return (async function (controller, promise, pull) {
        while (!ended) {
          await pull(controller);
        }
        return await promise;
      })(controller, promise, pull);
    }

    return capability.promise;
  } catch (e) {
    didError = true;
    __intrinsic__readableStreamError(stream, e);
    return Promise.__intrinsic__reject(e);
  } finally {
    if (!didError && stream) __intrinsic__readableStreamClose(stream);
    controller = close = sink = pull = stream = undefined;
  }
}).$$capture_end$$;
