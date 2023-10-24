// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/JSBufferPrototype.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(offset,byteLength) {  const view = (this.__intrinsic__dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1: {
      return view.getUint8(offset);
    }
    case 2: {
      return view.getUint16(offset, true);
    }
    case 3: {
      return view.getUint16(offset, true) + view.getUint8(offset + 2) * 2 ** 16;
    }
    case 4: {
      return view.getUint32(offset, true);
    }
    case 5: {
      return view.getUint8(offset + 4) * 2 ** 32 + view.getUint32(offset, true);
    }
    case 6: {
      return view.getUint16(offset + 4, true) * 2 ** 32 + view.getUint32(offset, true);
    }
  }
  __intrinsic__throwRangeError("byteLength must be >= 1 and <= 6");
}).$$capture_end$$;
