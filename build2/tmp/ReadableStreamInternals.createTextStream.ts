// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(highWaterMark) {  var sink;
  var array = [];
  var hasString = false;
  var hasBuffer = false;
  var rope = "";
  var estimatedLength = __intrinsic__toLength(0);
  var capability = __intrinsic__newPromiseCapability(Promise);
  var calledDone = false;

  sink = {
    start() {},
    write(chunk) {
      if (typeof chunk === "string") {
        var chunkLength = __intrinsic__toLength(chunk.length);
        if (chunkLength > 0) {
          rope += chunk;
          hasString = true;
          // TODO: utf16 byte length
          estimatedLength += chunkLength;
        }

        return chunkLength;
      }

      if (!chunk || !(__intrinsic__ArrayBuffer.__intrinsic__isView(chunk) || chunk instanceof __intrinsic__ArrayBuffer)) {
        __intrinsic__throwTypeError("Expected text, ArrayBuffer or ArrayBufferView");
      }

      const byteLength = __intrinsic__toLength(chunk.byteLength);
      if (byteLength > 0) {
        hasBuffer = true;
        if (rope.length > 0) {
          __intrinsic__arrayPush(array, rope);
          __intrinsic__arrayPush(array, chunk);
          rope = "";
        } else {
          __intrinsic__arrayPush(array, chunk);
        }
      }
      estimatedLength += byteLength;
      return byteLength;
    },

    flush() {
      return 0;
    },

    end() {
      if (calledDone) {
        return "";
      }
      return sink.fulfill();
    },

    fulfill() {
      calledDone = true;
      const result = sink.finishInternal();

      __intrinsic__fulfillPromise(capability.promise, result);
      return result;
    },

    finishInternal() {
      if (!hasString && !hasBuffer) {
        return "";
      }

      if (hasString && !hasBuffer) {
        return rope;
      }

      if (hasBuffer && !hasString) {
        return new globalThis.TextDecoder().decode(Bun.concatArrayBuffers(array));
      }

      // worst case: mixed content

      var arrayBufferSink = new Bun.ArrayBufferSink();
      arrayBufferSink.start({
        highWaterMark: estimatedLength,
        asUint8Array: true,
      });
      for (let item of array) {
        arrayBufferSink.write(item);
      }
      array.length = 0;
      if (rope.length > 0) {
        arrayBufferSink.write(rope);
        rope = "";
      }

      // TODO: use builtin
      return new globalThis.TextDecoder().decode(arrayBufferSink.end());
    },

    close() {
      try {
        if (!calledDone) {
          calledDone = true;
          sink.fulfill();
        }
      } catch (e) {}
    },
  };

  return [sink, capability];
}).$$capture_end$$;
