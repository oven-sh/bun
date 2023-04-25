/*
 * Copyright 2023 Codeblog Corp. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


// ^ that comment is required or the builtins generator will have a fit.

// The fastest way as of April 2022 is to use DataView.
// DataView has intrinsics that cause inlining

function setBigUint64(offset, value, le) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setBigUint64(offset, value, le);
}
function readInt8(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt8(offset);
}
function readUInt8(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint8(offset);
}
function readInt16LE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt16(offset, true);
}
function readInt16BE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt16(offset, false);
}
function readUInt16LE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint16(offset, true);
}
function readUInt16BE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint16(offset, false);
}
function readInt32LE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt32(offset, true);
}
function readInt32BE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getInt32(offset, false);
}
function readUInt32LE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint32(offset, true);
}
function readUInt32BE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getUint32(offset, false);
}

function readIntLE(offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
  switch (byteLength) {
    case 1: {
      return view.getInt8(offset);
    }
    case 2: {
      return view.getInt16(offset, true);
    }
    case 3: {
      const val = view.getUint16(offset, true) + view.getUint8(offset + 2) * 2 ** 16;
      return val | (val & 2 ** 23) * 0x1fe;
    }
    case 4: {
      return view.getInt32(offset, true);
    }
    case 5: {
      const last = view.getUint8(offset + 4);
      return (last | (last & 2 ** 7) * 0x1fffffe) * 2 ** 32 + view.getUint32(offset, true);
    }
    case 6: {
      const last = view.getUint16(offset + 4, true);
      return (last | (last & 2 ** 15) * 0x1fffe) * 2 ** 32 + view.getUint32(offset, true);
    }
  }
  @throwRangeError("byteLength must be >= 1 and <= 6");
}
function readIntBE(offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
  switch (byteLength) {
    case 1: {
      return view.getInt8(offset);
    }
    case 2: {
      return view.getInt16(offset, false);
    }
    case 3: {
      const val = view.getUint16(offset + 1, false) + view.getUint8(offset) * 2 ** 16;
      return val | (val & 2 ** 23) * 0x1fe;
    }
    case 4: {
      return view.getInt32(offset, false);
    }
    case 5: {
      const last = view.getUint8(offset);
      return (last | (last & 2 ** 7) * 0x1fffffe) * 2 ** 32 + view.getUint32(offset + 1, false);
    }
    case 6: {
      const last = view.getUint16(offset, false);
      return (last | (last & 2 ** 15) * 0x1fffe) * 2 ** 32 + view.getUint32(offset + 2, false);
    }
  }
  @throwRangeError("byteLength must be >= 1 and <= 6");
}
function readUIntLE(offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
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
  @throwRangeError("byteLength must be >= 1 and <= 6");
}
function readUIntBE(offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
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
      const last = view.getUint8(offset);
      return (last | (last & 2 ** 7) * 0x1fffffe) * 2 ** 32 + view.getUint32(offset + 1, false);
    }
    case 6: {
      const last = view.getUint16(offset, false);
      return (last | (last & 2 ** 15) * 0x1fffe) * 2 ** 32 + view.getUint32(offset + 2, false);
    }
  }
  @throwRangeError("byteLength must be >= 1 and <= 6");
}

function readFloatLE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat32(offset, true);
}
function readFloatBE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat32(offset, false);
}
function readDoubleLE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat64(offset, true);
}
function readDoubleBE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getFloat64(offset, false);
}
function readBigInt64LE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigInt64(offset, true);
}
function readBigInt64BE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigInt64(offset, false);
}
function readBigUInt64LE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigUint64(offset, true);
}
function readBigUInt64BE(offset) {
  "use strict";
  return (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).getBigUint64(offset, false);
}

function writeInt8(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt8(offset, value);
  return offset + 1;
}
function writeUInt8(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint8(offset, value);
  return offset + 1;
}
function writeInt16LE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt16(offset, value, true);
  return offset + 2;
}
function writeInt16BE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt16(offset, value, false);
  return offset + 2;
}
function writeUInt16LE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint16(offset, value, true);
  return offset + 2;
}
function writeUInt16BE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint16(offset, value, false);
  return offset + 2;
}
function writeInt32LE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt32(offset, value, true);
  return offset + 4;
}
function writeInt32BE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setInt32(offset, value, false);
  return offset + 4;
}
function writeUInt32LE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint32(offset, value, true);
  return offset + 4;
}
function writeUInt32BE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setUint32(offset, value, false);
  return offset + 4;
}

function writeIntLE(value, offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
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
      view.setUint16(offset, value & 0xFFFF, true);
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
      @throwRangeError("byteLength must be >= 1 and <= 6");
    }
  }
  return offset + byteLength;
}
function writeIntBE(value, offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
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
      view.setUint16(offset + 1, value & 0xFFFF, false);
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
    default: {
      @throwRangeError("byteLength must be >= 1 and <= 6");
    }
  }
  return offset + byteLength;
}
function writeUIntLE(value, offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
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
      view.setUint16(offset, value & 0xFFFF, true);
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
    default: {
      @throwRangeError("byteLength must be >= 1 and <= 6");
    }
  }
  return offset + byteLength;
}
function writeUIntBE(value, offset, byteLength) {
  "use strict";
  const view = this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength);
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
      view.setUint16(offset + 1, value & 0xFFFF, false);
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
      @throwRangeError("byteLength must be >= 1 and <= 6");
    }
  }
  return offset + byteLength;
}

function writeFloatLE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat32(offset, value, true);
  return offset + 4;
}

function writeFloatBE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat32(offset, value, false);
  return offset + 4;
}

function writeDoubleLE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat64(offset, value, true);
  return offset + 8;
}

function writeDoubleBE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setFloat64(offset, value, false);
  return offset + 8;
}

function writeBigInt64LE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setBigInt64(offset, value, true);
  return offset + 8;
}

function writeBigInt64BE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setBigInt64(offset, value, false);
  return offset + 8;
}

function writeBigUInt64LE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setBigUint64(offset, value, true);
  return offset + 8;
}

function writeBigUInt64BE(value, offset) {
  "use strict";
  (this.@dataView ||= new DataView(this.buffer, this.byteOffset, this.byteLength)).setBigUint64(offset, value, false);
  return offset + 8;
}

function utf8Write(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "utf8");
}
function ucs2Write(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "ucs2");
}
function utf16leWrite(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "utf16le");
}
function latin1Write(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "latin1");
}
function asciiWrite(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "ascii");
}
function base64Write(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "base64");
}
function base64urlWrite(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "base64url");
}
function hexWrite(text, offset, length) {
  "use strict";
  return this.write(text, offset, length, "hex");
}

function utf8Slice(offset, length) {
  "use strict";
  return this.toString(offset, length, "utf8");
}
function ucs2Slice(offset, length) {
  "use strict";
  return this.toString(offset, length, "ucs2");
}
function utf16leSlice(offset, length) {
  "use strict";
  return this.toString(offset, length, "utf16le");
}
function latin1Slice(offset, length) {
  "use strict";
  return this.toString(offset, length, "latin1");
}
function asciiSlice(offset, length) {
  "use strict";
  return this.toString(offset, length, "ascii");
}
function base64Slice(offset, length) {
  "use strict";
  return this.toString(offset, length, "base64");
}
function base64urlSlice(offset, length) {
  "use strict";
  return this.toString(offset, length, "base64url");
}
function hexSlice(offset, length) {
  "use strict";
  return this.toString(offset, length, "hex");
}

function toJSON() {
  "use strict";
  const type = "Buffer";
  const data = @Array.from(this);
  return { type, data };
}

function slice(start, end) {
  "use strict";
  var { buffer, byteOffset, byteLength } = this;

  function adjustOffset(offset, length) {
    // Use Math.trunc() to convert offset to an integer value that can be larger
    // than an Int32. Hence, don't use offset | 0 or similar techniques.
    offset = @trunc(offset);
    if (offset === 0 || @isNaN(offset)) {
      return 0;
    } else if (offset < 0) {
      offset += length;
      return offset > 0 ? offset : 0;
    } else {
      return offset < length ? offset : length;
    }
  }

  var start_ = adjustOffset(start, byteLength);
  var end_ = end !== @undefined ? adjustOffset(end, byteLength) : byteLength;
  return new Buffer(buffer, byteOffset + start_, end_ > start_ ? (end_ - start_) : 0);
}

@getter
function parent() {
  "use strict";
  return @isObject(this) && this instanceof @Buffer ? this.buffer : @undefined;
}

@getter
function offset() {
  "use strict";
  return @isObject(this) && this instanceof @Buffer ? this.byteOffset : @undefined;
}
