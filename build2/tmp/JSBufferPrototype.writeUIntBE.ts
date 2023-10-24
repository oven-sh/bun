// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/JSBufferPrototype.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(value,offset,byteLength) {  const view = (this.__intrinsic__dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1: {
      view.setUint8(offset, value);
      break;
    }
    case 2: {
      view.setUint16(offset, value, false);
      break;
    }
    case 3: {
      view.setUint16(offset + 1, value & 0xffff, false);
      view.setUint8(offset, Math.floor(value * 2 ** -16));
      break;
    }
    case 4: {
      view.setUint32(offset, value, false);
      break;
    }
    case 5: {
      view.setUint32(offset + 1, value | 0, false);
      view.setUint8(offset, Math.floor(value * 2 ** -32));
      break;
    }
    case 6: {
      view.setUint32(offset + 2, value | 0, false);
      view.setUint16(offset, Math.floor(value * 2 ** -32), false);
      break;
    }
    default: {
      __intrinsic__throwRangeError("byteLength must be >= 1 and <= 6");
    }
  }
  return offset + byteLength;
}).$$capture_end$$;
