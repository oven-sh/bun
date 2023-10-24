// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  var reader = stream.getReader();
  var manyResult = reader.readMany();

  async function processManyResult(result) {
    if (result.done) {
      return [];
    }

    var chunks = result.value || [];

    while (true) {
      var thisResult = await reader.read();
      if (thisResult.done) {
        break;
      }
      chunks = chunks.concat(thisResult.value);
    }

    return chunks;
  }

  if (manyResult && __intrinsic__isPromise(manyResult)) {
    return manyResult.__intrinsic__then(processManyResult);
  }

  return processManyResult(manyResult);
}).$$capture_end$$;
