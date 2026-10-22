const buffer = Buffer.from([255, 255, 255, 255, 0, 0, 248, 63]);
console.log(buffer.readInt8(0) + 1, buffer.readUInt32BE(0) + 1, buffer.readInt32LE(0) + 1, typeof buffer.readDoubleLE(0), buffer.readBigInt64LE(0) + 1n, buffer.readFloatLE(4) + 1);
