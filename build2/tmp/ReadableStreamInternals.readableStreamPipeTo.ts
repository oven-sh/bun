// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,sink) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStream(stream),"$isReadableStream(stream)"):void 0);

  const reader = new ReadableStreamDefaultReader(stream);

  __intrinsic__getByIdDirectPrivate(reader, "closedPromiseCapability").promise.__intrinsic__then(
    () => {},
    e => {
      sink.error(e);
    },
  );

  function doPipe() {
    __intrinsic__readableStreamDefaultReaderRead(reader).__intrinsic__then(
      function (result) {
        if (result.done) {
          sink.close();
          return;
        }
        try {
          sink.enqueue(result.value);
        } catch (e) {
          sink.error("ReadableStream chunk enqueueing in the sink failed");
          return;
        }
        doPipe();
      },
      function (e) {
        sink.error(e);
      },
    );
  }
  doPipe();
}).$$capture_end$$;
