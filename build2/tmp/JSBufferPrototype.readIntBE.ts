// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/JSBufferPrototype.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(offset,byteLength) {  const view = (this.__intrinsic__dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1: {
      return view.getInt8(offset);
    }
    case 2: {
      return view.getInt16(offset, false);
    }
    case 3: {
      const val = view.getUint16(offset + 1, false) + view.getUint8(offset) * 2 ** 16;
      return val | ((val & (2 ** 23)) * 0x1fe);
    }
    case 4: {
      return view.getInt32(offset, false);
    }
    case 5: {
      const last = view.getUint8(offset);
      return (last | ((last & (2 ** 7)) * 0x1fffffe)) * 2 ** 32 + view.getUint32(offset + 1, false);
    }
    case 6: {
      const last = view.getUint16(offset, false);
      return (last | ((last & (2 ** 15)) * 0x1fffe)) * 2 ** 32 + view.getUint32(offset + 2, false);
    }
  }
  __intrinsic__throwRangeError("byteLength must be >= 1 and <= 6");
}).$$capture_end$$;
