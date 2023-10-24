// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,contentType,) {  return Bun.readableStreamToBlob(stream).then(blob => {
    return FormData.from(blob, contentType);
  });
}).$$capture_end$$;
