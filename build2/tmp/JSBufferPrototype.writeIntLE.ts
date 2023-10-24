// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/JSBufferPrototype.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(value,offset,byteLength) {  const view = (this.__intrinsic__dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1: {
      view.setInt8(offset, value);
      break;
    }
    case 2: {
      view.setInt16(offset, value, true);
      break;
    }
    case 3: {
      view.setUint16(offset, value & 0xffff, true);
      view.setInt8(offset + 2, Math.floor(value * 2 ** -16));
      break;
    }
    case 4: {
      view.setInt32(offset, value, true);
      break;
    }
    case 5: {
      view.setUint32(offset, value | 0, true);
      view.setInt8(offset + 4, Math.floor(value * 2 ** -32));
      break;
    }
    case 6: {
      view.setUint32(offset, value | 0, true);
      view.setInt16(offset + 4, Math.floor(value * 2 ** -32), true);
      break;
    }
    default: {
      __intrinsic__throwRangeError("byteLength must be >= 1 and <= 6");
    }
  }
  return offset + byteLength;
}).$$capture_end$$;
