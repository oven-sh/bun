// The fixed-width readers/writers (readInt8 ... writeDoubleBE) are C++ host functions in
// JSBuffer.cpp with a DFG/FTL intrinsic; the variable-width ones below still go through a
// lazily-created DataView (whose accessors JSC also inlines).

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
      // Infinity must fall through to boundsError() so it reports the
      // ">= 0 and <= N" range like Node, not "an integer".
      if (typeof offset !== "number" || ((offset | 0) !== offset && offset !== Infinity && offset !== -Infinity))
        require("internal/validators").validateInteger(offset, "offset");
      let thisLength;
      if (!(offset >= 0 && offset <= (thisLength = this.length) - byteLength))
        require("internal/buffer").boundsError(offset, (thisLength ?? this.length) - byteLength);
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
      // Infinity must fall through to boundsError() so it reports the
      // ">= 0 and <= N" range like Node, not "an integer".
      if (typeof offset !== "number" || ((offset | 0) !== offset && offset !== Infinity && offset !== -Infinity))
        require("internal/validators").validateInteger(offset, "offset");
      let thisLength;
      if (!(offset >= 0 && offset <= (thisLength = this.length) - byteLength))
        require("internal/buffer").boundsError(offset, (thisLength ?? this.length) - byteLength);
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
      // Infinity must fall through to boundsError() so it reports the
      // ">= 0 and <= N" range like Node, not "an integer".
      if (typeof offset !== "number" || ((offset | 0) !== offset && offset !== Infinity && offset !== -Infinity))
        require("internal/validators").validateInteger(offset, "offset");
      let thisLength;
      if (!(offset >= 0 && offset <= (thisLength = this.length) - byteLength))
        require("internal/buffer").boundsError(offset, (thisLength ?? this.length) - byteLength);
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
      // Infinity must fall through to boundsError() so it reports the
      // ">= 0 and <= N" range like Node, not "an integer".
      if (typeof offset !== "number" || ((offset | 0) !== offset && offset !== Infinity && offset !== -Infinity))
        require("internal/validators").validateInteger(offset, "offset");
      let thisLength;
      if (!(offset >= 0 && offset <= (thisLength = this.length) - byteLength))
        require("internal/buffer").boundsError(offset, (thisLength ?? this.length) - byteLength);
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

export function toJSON(this: BufferExt) {
  const type = "Buffer";
  const data = Array.from(this);
  return { type, data };
}

$getter;
export function parent(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.buffer : undefined;
}

$getter;
export function offset(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.byteOffset : undefined;
}
