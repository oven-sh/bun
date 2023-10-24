// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(async function(stream,underlyingSource) {  const capability = __intrinsic__initializeArrayStream.__intrinsic__call(stream, underlyingSource, undefined);
  underlyingSource = undefined;
  var reader = stream.getReader();
  try {
    while (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable) {
      var thisResult = await reader.read();
      if (thisResult.done) {
        break;
      }
    }

    try {
      reader.releaseLock();
    } catch (e) {}
    reader = undefined;

    return Promise.__intrinsic__resolve(capability.promise);
  } catch (e) {
    throw e;
  } finally {
    stream = undefined;
    reader = undefined;
  }
}).$$capture_end$$;
