// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/JSBufferPrototype.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(start,end) {  var { buffer, byteOffset, byteLength } = this;

  function adjustOffset(offset, length) {
    // Use Math.trunc() to convert offset to an integer value that can be larger
    // than an Int32. Hence, don't use offset | 0 or similar techniques.
    offset = __intrinsic__trunc(offset);
    if (offset === 0 || offset !== offset) {
      return 0;
    } else if (offset < 0) {
      offset += length;
      return offset > 0 ? offset : 0;
    } else {
      return offset < length ? offset : length;
    }
  }

  var start_ = adjustOffset(start, byteLength);
  var end_ = end !== undefined ? adjustOffset(end, byteLength) : byteLength;
  return new __intrinsic__Buffer(buffer, byteOffset + start_, end_ > start_ ? end_ - start_ : 0);
}).$$capture_end$$;
