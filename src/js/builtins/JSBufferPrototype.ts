// The fastest way as of April 2022 is to use DataView.
// DataView has intrinsics that cause inlining

interface BufferExt extends Buffer {
  $dataView?: DataView;

  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  toString(offset: number, length: number, encoding?: BufferEncoding): string;
}

export function setBigUint64(this: BufferExt, offset, value, le) {
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setBigUint64(
    offset,
    value,
    le,
  );
}

export function readInt8(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined) $checkBufferRead(this, offset, 1);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt8(offset);
}

export function readUInt8(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined) $checkBufferRead(this, offset, 1);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint8(offset);
}

export function readInt16LE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 1] === undefined)
    $checkBufferRead(this, offset, 2);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt16(offset, true);
}

export function readInt16BE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 1] === undefined)
    $checkBufferRead(this, offset, 2);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt16(offset, false);
}

export function readUInt16LE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 1] === undefined)
    $checkBufferRead(this, offset, 2);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint16(offset, true);
}

export function readUInt16BE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 1] === undefined)
    $checkBufferRead(this, offset, 2);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint16(offset, false);
}

export function readInt32LE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined)
    $checkBufferRead(this, offset, 4);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt32(offset, true);
}

export function readInt32BE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined)
    $checkBufferRead(this, offset, 4);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt32(offset, false);
}

export function readUInt32LE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined)
    $checkBufferRead(this, offset, 4);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint32(offset, true);
}

export function readUInt32BE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined)
    $checkBufferRead(this, offset, 4);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint32(offset, false);
}

export function readIntLE(this: BufferExt, offset, byteLength) {
  if (offset === undefined) throw $ERR_INVALID_ARG_TYPE("offset", "number", offset);
  if (typeof byteLength !== "number") throw $ERR_INVALID_ARG_TYPE("byteLength", "number", byteLength);
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      if (typeof offset !== "number" || (offset | 0) !== offset)
        require("internal/validators").validateInteger(offset, "offset");
      if (!(offset >= 0 && offset <= this.length - byteLength))
        require("internal/buffer").boundsError(offset, this.length - byteLength);
    }
  }
  switch (byteLength) {
    case 1: {
      return view.getInt8(offset);
    }
    case 2: {
      return view.getInt16(offset, true);
    }
    case 3: {
      const val = view.getUint16(offset, true) + view.getUint8(offset + 2) * 2 ** 16;
      return val | ((val & (2 ** 23)) * 0x1fe);
    }
    case 4: {
      return view.getInt32(offset, true);
    }
    case 5: {
      const last = view.getUint8(offset + 4);
      return (last | ((last & (2 ** 7)) * 0x1fffffe)) * 2 ** 32 + view.getUint32(offset, true);
    }
    case 6: {
      const last = view.getUint16(offset + 4, true);
      return (last | ((last & (2 ** 15)) * 0x1fffe)) * 2 ** 32 + view.getUint32(offset, true);
    }
  }
  require("internal/buffer").boundsError(byteLength, 6, "byteLength");
}

export function readIntBE(this: BufferExt, offset, byteLength) {
  if (offset === undefined) throw $ERR_INVALID_ARG_TYPE("offset", "number", offset);
  if (typeof byteLength !== "number") throw $ERR_INVALID_ARG_TYPE("byteLength", "number", byteLength);
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      if (typeof offset !== "number" || (offset | 0) !== offset)
        require("internal/validators").validateInteger(offset, "offset");
      if (!(offset >= 0 && offset <= this.length - byteLength))
        require("internal/buffer").boundsError(offset, this.length - byteLength);
    }
  }
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
  require("internal/buffer").boundsError(byteLength, 6, "byteLength");
}

export function readUIntLE(this: BufferExt, offset, byteLength) {
  if (offset === undefined) throw $ERR_INVALID_ARG_TYPE("offset", "number", offset);
  if (typeof byteLength !== "number") throw $ERR_INVALID_ARG_TYPE("byteLength", "number", byteLength);
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      if (typeof offset !== "number" || (offset | 0) !== offset)
        require("internal/validators").validateInteger(offset, "offset");
      if (!(offset >= 0 && offset <= this.length - byteLength))
        require("internal/buffer").boundsError(offset, this.length - byteLength);
    }
  }
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
  require("internal/buffer").boundsError(byteLength, 6, "byteLength");
}

export function readUIntBE(this: BufferExt, offset, byteLength) {
  if (offset === undefined) throw $ERR_INVALID_ARG_TYPE("offset", "number", offset);
  if (typeof byteLength !== "number") throw $ERR_INVALID_ARG_TYPE("byteLength", "number", byteLength);
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      if (typeof offset !== "number" || (offset | 0) !== offset)
        require("internal/validators").validateInteger(offset, "offset");
      if (!(offset >= 0 && offset <= this.length - byteLength))
        require("internal/buffer").boundsError(offset, this.length - byteLength);
    }
  }
  switch (byteLength) {
    case 1: {
      return view.getUint8(offset);
    }
    case 2: {
      return view.getUint16(offset, false);
    }
    case 3: {
      return view.getUint16(offset + 1, false) + view.getUint8(offset) * 2 ** 16;
    }
    case 4: {
      return view.getUint32(offset, false);
    }
    case 5: {
      return view.getUint8(offset) * 2 ** 32 + view.getUint32(offset + 1, false);
    }
    case 6: {
      return view.getUint16(offset, false) * 2 ** 32 + view.getUint32(offset + 2, false);
    }
  }
  require("internal/buffer").boundsError(byteLength, 6, "byteLength");
}

export function readFloatLE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined)
    $checkBufferRead(this, offset, 4);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat32(offset, true);
}

export function readFloatBE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined)
    $checkBufferRead(this, offset, 4);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat32(offset, false);
}

export function readDoubleLE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined)
    $checkBufferRead(this, offset, 8);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat64(offset, true);
}

export function readDoubleBE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined)
    $checkBufferRead(this, offset, 8);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat64(offset, false);
}

export function readBigInt64LE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined)
    $checkBufferRead(this, offset, 8);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigInt64(offset, true);
}

export function readBigInt64BE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined)
    $checkBufferRead(this, offset, 8);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigInt64(offset, false);
}

export function readBigUInt64LE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined)
    $checkBufferRead(this, offset, 8);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigUint64(offset, true);
}

export function readBigUInt64BE(this: BufferExt, offset) {
  if (offset === undefined) offset = 0;
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined)
    $checkBufferRead(this, offset, 8);
  return (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigUint64(offset, false);
}

export function writeInt8(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = -0x80;
  const max = 0x7f;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined) require("internal/buffer").writeU_Int8(this, value, offset, min, max);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt8(offset, value);
  return offset + 1;
}

export function writeUInt8(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = 0;
  const max = 0xff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined) require("internal/buffer").writeU_Int8(this, value, offset, min, max);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint8(offset, value);
  return offset + 1;
}

export function writeInt16LE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = -0x8000;
  const max = 0x7fff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 1] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 2);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt16(offset, value, true);
  return offset + 2;
}

export function writeInt16BE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = -0x8000;
  const max = 0x7fff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 1] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 2);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt16(offset, value, false);
  return offset + 2;
}

export function writeUInt16LE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = 0;
  const max = 0xffff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 1] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 2);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint16(offset, value, true);
  return offset + 2;
}

export function writeUInt16BE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = 0;
  const max = 0xffff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 1] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 2);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint16(offset, value, false);
  return offset + 2;
}

export function writeInt32LE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = -0x80000000;
  const max = 0x7fffffff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 3] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 4);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt32(offset, value, true);
  return offset + 4;
}

export function writeInt32BE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = -0x80000000;
  const max = 0x7fffffff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 3] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 4);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt32(offset, value, false);
  return offset + 4;
}

export function writeUInt32LE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = 0;
  const max = 0xffffffff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 3] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 4);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint32(offset, value, true);
  return offset + 4;
}

export function writeUInt32BE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  const min = 0;
  const max = 0xffffffff;
  // prettier-ignore
  if (typeof offset !== "number" || value < min || value > max || this[offset] === undefined || this[offset + 3] === undefined) require("internal/buffer").checkInt(this, value, offset, min, max, 4);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint32(offset, value, false);
  return offset + 4;
}

export function writeIntLE(this: BufferExt, value, offset, byteLength) {
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  value = +value;

  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      const max = 2 ** (8 * byteLength - 1) - 1;
      require("internal/buffer").checkInt(this, value, offset, -max - 1, max, byteLength);
      break;
    }
    default: {
      require("internal/buffer").boundsError(byteLength, 6, "byteLength");
      break;
    }
  }
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
  }
  return offset + byteLength;
}

export function writeIntBE(this: BufferExt, value, offset, byteLength) {
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  value = +value;

  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      const max = 2 ** (8 * byteLength - 1) - 1;
      require("internal/buffer").checkInt(this, value, offset, -max - 1, max, byteLength);
      break;
    }
    default: {
      require("internal/buffer").boundsError(byteLength, 6, "byteLength");
      break;
    }
  }
  switch (byteLength) {
    case 1: {
      view.setInt8(offset, value);
      break;
    }
    case 2: {
      view.setInt16(offset, value, false);
      break;
    }
    case 3: {
      view.setUint16(offset + 1, value & 0xffff, false);
      view.setInt8(offset, Math.floor(value * 2 ** -16));
      break;
    }
    case 4: {
      view.setInt32(offset, value, false);
      break;
    }
    case 5: {
      view.setUint32(offset + 1, value | 0, false);
      view.setInt8(offset, Math.floor(value * 2 ** -32));
      break;
    }
    case 6: {
      view.setUint32(offset + 2, value | 0, false);
      view.setInt16(offset, Math.floor(value * 2 ** -32), false);
      break;
    }
  }
  return offset + byteLength;
}

export function writeUIntLE(this: BufferExt, value, offset, byteLength) {
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  value = +value;

  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      require("internal/buffer").checkInt(this, value, offset, 0, 2 ** (8 * byteLength) - 1, byteLength);
      break;
    }
    default: {
      require("internal/buffer").boundsError(byteLength, 6, "byteLength");
      break;
    }
  }
  switch (byteLength) {
    case 1: {
      view.setUint8(offset, value);
      break;
    }
    case 2: {
      view.setUint16(offset, value, true);
      break;
    }
    case 3: {
      view.setUint16(offset, value & 0xffff, true);
      view.setUint8(offset + 2, Math.floor(value * 2 ** -16));
      break;
    }
    case 4: {
      view.setUint32(offset, value, true);
      break;
    }
    case 5: {
      view.setUint32(offset, value | 0, true);
      view.setUint8(offset + 4, Math.floor(value * 2 ** -32));
      break;
    }
    case 6: {
      view.setUint32(offset, value | 0, true);
      view.setUint16(offset + 4, Math.floor(value * 2 ** -32), true);
      break;
    }
  }
  return offset + byteLength;
}

export function writeUIntBE(this: BufferExt, value, offset, byteLength) {
  const view = (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength));
  value = +value;

  switch (byteLength) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6: {
      require("internal/buffer").checkInt(this, value, offset, 0, 2 ** (8 * byteLength) - 1, byteLength);
      break;
    }
    default: {
      require("internal/buffer").boundsError(byteLength, 6, "byteLength");
      break;
    }
  }
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
  }
  return offset + byteLength;
}

export function writeFloatLE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  // prettier-ignore
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined) require("internal/buffer").checkBounds(this, offset, 4);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat32(offset, value, true);
  return offset + 4;
}

export function writeFloatBE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  // prettier-ignore
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 3] === undefined) require("internal/buffer").checkBounds(this, offset, 4);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat32(offset, value, false);
  return offset + 4;
}

export function writeDoubleLE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  // prettier-ignore
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined) require("internal/buffer").checkBounds(this, offset, 8);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat64(offset, value, true);
  return offset + 8;
}

export function writeDoubleBE(this: BufferExt, value, offset) {
  if (offset === undefined) offset = 0;
  value = +value;
  // prettier-ignore
  if (typeof offset !== "number" || this[offset] === undefined || this[offset + 7] === undefined) require("internal/buffer").checkBounds(this, offset, 8);
  (this.$dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat64(offset, value, false);
  return offset + 8;
}

export function toJSON(this: BufferExt) {
  const type = "Buffer";
  const data = Array.from(this);
  return { type, data };
}

export function slice(this: BufferExt, start, end) {
  var { buffer, byteOffset, byteLength } = this;

  function adjustOffset(offset, length) {
    // Use Math.trunc() to convert offset to an integer value that can be larger
    // than an Int32. Hence, don't use offset | 0 or similar techniques.
    offset = Math.trunc(offset);
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
  return new $Buffer(buffer, byteOffset + start_, end_ > start_ ? end_ - start_ : 0);
}

$getter;
export function parent(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.buffer : undefined;
}

$getter;
export function offset(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.byteOffset : undefined;
}
