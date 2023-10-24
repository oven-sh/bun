// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ConsoleObject.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(input) {  var writer = __intrinsic__getByIdDirectPrivate(this, "writer");
  if (!writer) {
    var length = __intrinsic__toLength(input?.length ?? 0);
    writer = Bun.stdout.writer({ highWaterMark: length > 65536 ? length : 65536 });
    __intrinsic__putByIdDirectPrivate(this, "writer", writer);
  }

  var wrote = writer.write(input);

  const count = __intrinsic__argumentCount();
  for (var i = 1; i < count; i++) {
    wrote += writer.write(arguments[i]);
  }

  writer.flush(true);
  return wrote;
}).$$capture_end$$;
