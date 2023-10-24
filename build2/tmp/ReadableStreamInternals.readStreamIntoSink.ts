// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(async function(stream,sink,isNative) {  var didClose = false;
  var didThrow = false;
  try {
    var reader = stream.getReader();
    var many = reader.readMany();
    if (many && __intrinsic__isPromise(many)) {
      many = await many;
    }
    if (many.done) {
      didClose = true;
      return sink.end();
    }
    var wroteCount = many.value.length;
    const highWaterMark = __intrinsic__getByIdDirectPrivate(stream, "highWaterMark");
    if (isNative)
      __intrinsic__startDirectStream.__intrinsic__call(
        sink,
        stream,
        undefined,
        () => !didThrow && __intrinsic__markPromiseAsHandled(stream.cancel()),
        stream.__intrinsic__asyncContext,
      );

    sink.start({ highWaterMark: highWaterMark || 0 });

    for (var i = 0, values = many.value, length = many.value.length; i < length; i++) {
      sink.write(values[i]);
    }

    var streamState = __intrinsic__getByIdDirectPrivate(stream, "state");
    if (streamState === __intrinsic__streamClosed) {
      didClose = true;
      return sink.end();
    }

    while (true) {
      var { value, done } = await reader.read();
      if (done) {
        didClose = true;
        return sink.end();
      }

      sink.write(value);
    }
  } catch (e) {
    didThrow = true;

    try {
      reader = undefined;
      const prom = stream.cancel(e);
      __intrinsic__markPromiseAsHandled(prom);
    } catch (j) {}

    if (sink && !didClose) {
      didClose = true;
      try {
        sink.close(e);
      } catch (j) {
        throw new globalThis.AggregateError([e, j]);
      }
    }

    throw e;
  } finally {
    if (reader) {
      try {
        reader.releaseLock();
      } catch (e) {}
      reader = undefined;
    }
    sink = undefined;
    var streamState = __intrinsic__getByIdDirectPrivate(stream, "state");
    if (stream) {
      // make it easy for this to be GC'd
      // but don't do property transitions
      var readableStreamController = __intrinsic__getByIdDirectPrivate(stream, "readableStreamController");
      if (readableStreamController) {
        if (__intrinsic__getByIdDirectPrivate(readableStreamController, "underlyingSource"))
          __intrinsic__putByIdDirectPrivate(readableStreamController, "underlyingSource", undefined);
        if (__intrinsic__getByIdDirectPrivate(readableStreamController, "controlledReadableStream"))
          __intrinsic__putByIdDirectPrivate(readableStreamController, "controlledReadableStream", undefined);

        __intrinsic__putByIdDirectPrivate(stream, "readableStreamController", null);
        if (__intrinsic__getByIdDirectPrivate(stream, "underlyingSource"))
          __intrinsic__putByIdDirectPrivate(stream, "underlyingSource", undefined);
        readableStreamController = undefined;
      }

      if (!didThrow && streamState !== __intrinsic__streamClosed && streamState !== __intrinsic__streamErrored) {
        __intrinsic__readableStreamClose(stream);
      }
      stream = undefined;
    }
  }
}).$$capture_end$$;
