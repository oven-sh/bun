/*
 * Copyright 2016 Apple Inc. All rights reserved.
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
//

// note: the _view inline getter is structured this way for performance
// using a getter 

function readInt8(offset) {
  "use strict";
  return this.dataView.getInt8(offset);
}
function readUInt8(offset) {
  "use strict";
  return this.dataView.getUint8(offset);
}
function readInt16LE(offset) {
  "use strict";
  return this.dataView.getInt16(offset, true);
}
function readInt16BE(offset) {
  "use strict";
  return this.dataView.getInt16(offset, false);
}
function readUInt16LE(offset) {
  "use strict";
  return this.dataView.getUint16(offset, true);
}
function readUInt16BE(offset) {
  "use strict";
  return this.dataView.getUint16(offset, false);
}
function readInt32LE(offset) {
  "use strict";
  return this.dataView.getInt32(offset, true);
}
function readInt32BE(offset) {
  "use strict";
  return this.dataView.getInt32(offset, false);
}
function readUInt32LE(offset) {
  "use strict";
  return this.dataView.getUint32(offset, true);
}
function readUInt32BE(offset) {
  "use strict";
  return this.dataView.getUint32(offset, false);
}
function readFloatLE(offset) {
  "use strict";
  return this.dataView.getFloat32(offset, true);
}
function readFloatBE(offset) {
  "use strict";
  return this.dataView.getFloat32(offset, false);
}
function readDoubleLE(offset) {
  "use strict";
  return this.dataView.getFloat64(offset, true);
}
function readDoubleBE(offset) {
  "use strict";
  return this.dataView.getFloat64(offset, false);
}
function readBigInt64LE(offset) {
  "use strict";
  return this.dataView.getBigInt64(offset, true);
}
function readBigInt64BE(offset) {
  "use strict";
  return this.dataView.getBigInt64(offset, false);
}
function readBigUInt64LE(offset) {
  "use strict";
  return this.dataView.getBigUint64(offset, true);
}
function readBigUInt64BE(offset) {
  "use strict";
  return this.dataView.getBigUint64(offset, false);
}
function writeInt8(value, offset) {
  "use strict";
  this.dataView.setInt8(offset, value);
  return offset + 1;
}
function writeUInt8(value, offset) {
  "use strict";
  this.dataView.setUint8(offset, value);
  return offset + 1;
}
function writeInt16LE(value, offset) {
  "use strict";
  this.dataView.setInt16(offset, value, true);
  return offset + 2;
}
function writeInt16BE(value, offset) {
  "use strict";
  this.dataView.setInt16(offset, value, false);
  return offset + 2;
}
function writeUInt16LE(value, offset) {
  "use strict";
  this.dataView.setUint16(offset, value, true);
  return offset + 2;
}
function writeUInt16BE(value, offset) {
  "use strict";
  this.dataView.setUint16(offset, value, false);
  return offset + 2;
}
function writeInt32LE(value, offset) {
  "use strict";
  this.dataView.setInt32(offset, value, true);
  return offset + 4;
}
function writeInt32BE(value, offset) {
  "use strict";
  this.dataView.setInt32(offset, value, false);
  return offset + 4;
}
function writeUInt32LE(value, offset) {
  "use strict";
  this.dataView.setUint32(offset, value, true);
  return offset + 4;
}
function writeUInt32BE(value, offset) {
  "use strict";
  this.dataView.setUint32(offset, value, false);
  return offset + 4;
}

function writeFloatLE(value, offset) {
  "use strict";
  this.dataView.setFloat32(offset, value, true);
  return offset + 4;
}

function writeFloatBE(value, offset) {
  "use strict";
  this.dataView.setFloat32(offset, value, false);
  return offset + 4;
}

function writeDoubleLE(value, offset) {
  "use strict";
  this.dataView.setFloat64(offset, value, true);
  return offset + 8;
}

function writeDoubleBE(value, offset) {
  "use strict";
  this.dataView.setFloat64(offset, value, false);
  return offset + 8;
}

function writeBigInt64LE(value, offset) {
  "use strict";
  this.dataView.setBigInt64(offset, value, true);
  return offset + 8;
}

function writeBigInt64BE(value, offset) {
  "use strict";
  this.dataView.setBigInt64(offset, value, false);
  return offset + 8;
}

function writeBigUInt64LE(value, offset) {
  "use strict";
  this.dataView.setBigUint64(offset, value, true);
  return offset + 8;
}

function writeBigUInt64BE(value, offset) {
  "use strict";
  this.dataView.setBigUint64(offset, value, false);
  return offset + 8;
}

function slice(start, end) {
  "use strict";
  if (start === undefined && end === undefined) {
    return this;
  }

  return this.subarray(start, end);
}

function subarray(start, end) {
  "use strict";
  
  var array = new @Uint8Array(this.buffer, this.byteOffset + (start || 0), (end || this.byteLength)  - (start || 0));
  @setPrototypeDirect.@call(
    array,
    Buffer.prototype
  );
  array.dataView = new DataView(array.buffer, array.byteOffset, array.byteLength);
  return array;
}

function toJSON() {
  "use strict";
  const type = "Buffer";
  const data = @Array.from(this);
  return { type, data };
}

function initializeBunBuffer(parameters)
{
  "use strict";

}

