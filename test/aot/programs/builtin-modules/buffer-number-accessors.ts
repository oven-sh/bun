// Buffer's readers and writers of numbers are done in place where the receiver is a Buffer and the function found under the name is Bun's own: the same answers and the same errors as the functions give, at every offset and for every value, for every kind of receiver, and no longer where the program's own function, nothing or a getter is found first, on the buffer itself or on a class of the program that stands under Buffer.prototype. The digest of the row "on others" differs from plain Bun by one text: a receiver or argument that is an ordinary object is described without a look at its constructor, "Received [Object]" for "Received an instance of Object".
function told(error: any): string {
  return error?.code === undefined ? String(error?.name) : `${error.name}:${error.code}:${error.message}`;
}
const offsets: number[] = [0, 1, 2, 3, 5, 7, 8, 9, 12, 13, 14, 15, 16, 17, -1, -0, 0.5, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 53, -(2 ** 31)];
const odd: unknown[] = [undefined, null, "1", true, {}, [], 1n, Symbol.iterator, { valueOf: () => 1 }];
const numbers: number[] = [0, 1, -1, 127, 128, 255, 256, -128, -129, 32767, 32768, 65535, 65536, -32768, -32769, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, -(2 ** 31), -(2 ** 31) - 1, 0.5, 1.9, -1.9, NaN, Infinity, -Infinity, 1e300, -0, 3.4e38, 1e-320];
const integers: bigint[] = [0n, 1n, -1n, 2n ** 63n - 1n, 2n ** 63n, 2n ** 64n - 1n, 2n ** 64n, -(2n ** 63n), -(2n ** 63n) - 1n, 123456789012345678n];
type Reader = (buffer: Buffer, at: number[]) => string;
type OddReader = (buffer: Buffer, at: unknown[]) => string;
type Writer = (buffer: Buffer, at: number[]) => string;
const readers: Record<string, Reader> = {};
const oddReaders: Record<string, OddReader> = {};
const writers: Record<string, Writer> = {};
readers.readInt8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt8(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readInt8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt8(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeInt8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeInt8(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readInt16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt16LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readInt16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt16LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeInt16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeInt16LE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readInt16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt16BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readInt16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt16BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeInt16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeInt16BE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readInt32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt32LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readInt32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt32LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeInt32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeInt32LE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readInt32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt32BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readInt32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readInt32BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeInt32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeInt32BE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUInt8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt8(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUInt8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt8(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUInt8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUInt8(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUInt16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt16LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUInt16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt16LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUInt16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUInt16LE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUInt16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt16BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUInt16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt16BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUInt16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUInt16BE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUInt32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt32LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUInt32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt32LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUInt32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUInt32LE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUInt32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt32BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUInt32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUInt32BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUInt32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUInt32BE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUint8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint8(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUint8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint8(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUint8 = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUint8(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUint16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint16LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUint16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint16LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUint16LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUint16LE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUint16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint16BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUint16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint16BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUint16BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUint16BE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUint32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint32LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUint32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint32LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUint32LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUint32LE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readUint32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint32BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readUint32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readUint32BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeUint32BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeUint32BE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readFloatLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readFloatLE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readFloatLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readFloatLE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeFloatLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeFloatLE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readFloatBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readFloatBE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readFloatBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readFloatBE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeFloatBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeFloatBE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readDoubleLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readDoubleLE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readDoubleLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readDoubleLE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeDoubleLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeDoubleLE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readDoubleBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readDoubleBE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readDoubleBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readDoubleBE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeDoubleBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < numbers.length; k++) {
      try {
        out += String(buffer.writeDoubleBE(numbers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readBigInt64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigInt64LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readBigInt64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigInt64LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeBigInt64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < integers.length; k++) {
      try {
        out += String(buffer.writeBigInt64LE(integers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readBigInt64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigInt64BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readBigInt64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigInt64BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeBigInt64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < integers.length; k++) {
      try {
        out += String(buffer.writeBigInt64BE(integers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readBigUInt64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUInt64LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readBigUInt64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUInt64LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeBigUInt64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < integers.length; k++) {
      try {
        out += String(buffer.writeBigUInt64LE(integers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readBigUInt64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUInt64BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readBigUInt64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUInt64BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeBigUInt64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < integers.length; k++) {
      try {
        out += String(buffer.writeBigUInt64BE(integers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readBigUint64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUint64LE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readBigUint64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUint64LE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeBigUint64LE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < integers.length; k++) {
      try {
        out += String(buffer.writeBigUint64LE(integers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
readers.readBigUint64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUint64BE(at[i]!)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
oddReaders.readBigUint64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    try {
      out += String(buffer.readBigUint64BE(at[i] as any)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out;
};
writers.writeBigUint64BE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < integers.length; k++) {
      try {
        out += String(buffer.writeBigUint64BE(integers[k]!, at[i]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
const lengths: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 1.5, -1, NaN];
const oddValues: unknown[] = ["7", null, undefined, true, {}, [], [9], { valueOf: () => 5 }, "x", 1n];
type OddWriter = (buffer: Buffer, values: unknown[]) => string;
const oddWriters: Record<string, OddWriter> = {};
const wideReaders: Record<string, Reader> = {};
const wideWriters: Record<string, Writer> = {};
oddWriters.writeUInt8 = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeUInt8(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeInt8 = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeInt8(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeUInt16LE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeUInt16LE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeInt16BE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeInt16BE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeUInt32BE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeUInt32BE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeInt32LE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeInt32LE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeFloatLE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeFloatLE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeDoubleBE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeDoubleBE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeBigInt64LE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeBigInt64LE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
oddWriters.writeBigUInt64BE = (buffer, values) => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    try {
      out += String(buffer.writeBigUInt64BE(values[i] as any, 1)) + ",";
    } catch (error) {
      out += told(error) + ",";
    }
  }
  return out + buffer.toString("hex");
};
wideReaders.readIntLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      try {
        out += String(buffer.readIntLE(at[i]!, lengths[k]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
  }
  return out;
};
wideWriters.writeIntLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      for (let v = 0; v < numbers.length; v += 3) {
        try {
          out += String(buffer.writeIntLE(numbers[v]!, at[i]!, lengths[k]!)) + ",";
        } catch (error) {
          out += told(error) + ",";
        }
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
wideReaders.readIntBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      try {
        out += String(buffer.readIntBE(at[i]!, lengths[k]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
  }
  return out;
};
wideWriters.writeIntBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      for (let v = 0; v < numbers.length; v += 3) {
        try {
          out += String(buffer.writeIntBE(numbers[v]!, at[i]!, lengths[k]!)) + ",";
        } catch (error) {
          out += told(error) + ",";
        }
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
wideReaders.readUIntLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      try {
        out += String(buffer.readUIntLE(at[i]!, lengths[k]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
  }
  return out;
};
wideWriters.writeUIntLE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      for (let v = 0; v < numbers.length; v += 3) {
        try {
          out += String(buffer.writeUIntLE(numbers[v]!, at[i]!, lengths[k]!)) + ",";
        } catch (error) {
          out += told(error) + ",";
        }
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
wideReaders.readUIntBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      try {
        out += String(buffer.readUIntBE(at[i]!, lengths[k]!)) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
  }
  return out;
};
wideWriters.writeUIntBE = (buffer, at) => {
  let out = "";
  for (let i = 0; i < at.length; i++) {
    for (let k = 0; k < lengths.length; k++) {
      for (let v = 0; v < numbers.length; v += 3) {
        try {
          out += String(buffer.writeUIntBE(numbers[v]!, at[i]!, lengths[k]!)) + ",";
        } catch (error) {
          out += told(error) + ",";
        }
      }
    }
    out += buffer.toString("hex") + ";";
  }
  return out;
};
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16) + " " + text.length;
}
function filled(buffer: Buffer): Buffer {
  for (let i = 0; i < buffer.length; i++) buffer[i] = (i * 37 + 129) & 255;
  return buffer;
}
const resizable = new ArrayBuffer(16, { maxByteLength: 32 });
const receivers: [string, () => Buffer][] = [
  ["alloc", () => Buffer.alloc(16)],
  ["allocUnsafe", () => Buffer.allocUnsafe(16)],
  ["inside an ArrayBuffer", () => Buffer.from(new ArrayBuffer(40), 3, 16)],
  ["a slice", () => Buffer.alloc(64).subarray(5, 21)],
  ["short", () => Buffer.alloc(3)],
  ["empty", () => Buffer.alloc(0)],
  ["shared", () => Buffer.from(new SharedArrayBuffer(16))],
  ["resizable", () => Buffer.from(resizable)],
];
function all(title: string): void {
  for (const [kind, make] of receivers) {
    let read = "";
    let written = "";
    for (const name of Object.keys(readers)) read += readers[name]!(filled(make()), offsets) + oddReaders[name]!(filled(make()), odd);
    for (const name of Object.keys(writers)) written += writers[name]!(filled(make()), offsets);
    for (const name of Object.keys(oddWriters)) written += oddWriters[name]!(filled(make()), oddValues);
    for (const name of Object.keys(wideReaders)) read += wideReaders[name]!(filled(make()), [0, 1, 10, 13, 16, -1, 0.5]);
    for (const name of Object.keys(wideWriters)) written += wideWriters[name]!(filled(make()), [0, 11, 16]);
    console.log(title, kind, digest(read), digest(written));
  }
}
for (let round = 0; round < 3; round++) all("round " + round);
for (const name of Object.keys(readers)) console.log(name, readers[name]!(filled(Buffer.alloc(16)), [0, 1, 8, 9, 15, 16, -1, 0.5]));
for (const name of Object.keys(writers)) console.log(name, digest(writers[name]!(filled(Buffer.alloc(16)), [0, 7, 15])));

resizable.resize(4);
console.log("shrunk", readers.readUInt32LE!(Buffer.from(resizable), [0, 1, 4]), readers.readUInt8!(Buffer.from(resizable), [3, 4]));
resizable.resize(16);
const tracking = Buffer.from(resizable);
resizable.resize(2);
console.log("shrunk under it", tracking.length, readers.readUInt8!(tracking, [0, 1, 2, 15]), readers.readUInt32BE!(tracking, [0]), writers.writeUInt8!(tracking, [1, 2]));
const moved = new ArrayBuffer(16);
const detached = Buffer.from(moved);
structuredClone(moved, { transfer: [moved] });
console.log("detached", detached.length, readers.readUInt8!(detached, [0]), readers.readDoubleLE!(detached, [0]), writers.writeUInt16LE!(detached, [0]));

const bytes = filled(Buffer.alloc(16));
const prototype = Buffer.prototype as any;
console.log("aliases", prototype.readUint8 === prototype.readUInt8, prototype.writeUint32BE === prototype.writeUInt32BE, prototype.readBigUint64LE === prototype.readBigUInt64LE, prototype.readUintBE === prototype.readUIntBE);

function shrinksInTheLoop(): string {
  const memory = new ArrayBuffer(16, { maxByteLength: 16 });
  const view = filled(Buffer.from(memory));
  let out = "";
  for (let i = 0; i < 400; i++) {
    if (i === 300) memory.resize(6);
    if (i === 350) memory.resize(12);
    try {
      const value = view.readUInt32LE(i & 7) + view.readUInt8(i & 15) + view.writeUInt16BE(i, i & 7);
      if (i % 25 === 0 || (i >= 298 && i < 304)) out += value + ",";
    } catch (error) {
      if (i % 25 === 0 || (i >= 298 && i < 304)) out += told(error) + ",";
    }
  }
  return out + view.length;
}
console.log("shrinks in the loop", shrinksInTheLoop());

function valueThatActs(act: (memory: ArrayBuffer) => void): string {
  const memory = new ArrayBuffer(16, { maxByteLength: 16 });
  const view = filled(Buffer.from(memory)) as any;
  let out = "";
  for (let i = 0; i < 200; i++) {
    const value = i === 150 ? { valueOf: () => (act(memory), 7) } : i & 255;
    try {
      out = view.writeUInt8(value, 9) + "," + view.writeInt32LE(value, 8) + "," + view.writeDoubleBE(value, 8) + "," + view.length + ";" + (i >= 149 && i <= 151 ? out : "");
    } catch (error) {
      out = told(error) + ";" + out;
    }
  }
  return out + view.length;
}
console.log("a value that shrinks", valueThatActs(memory => memory.resize(4)));
console.log("a value that detaches", valueThatActs(memory => void structuredClone(memory, { transfer: [memory] })));

function onOthers(): string {
  let out = "";
  const others: unknown[] = [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), new Int8Array([-1, 2, -3, 4]), new Uint16Array([258, 772]), new DataView(new ArrayBuffer(8)), new Proxy(filled(Buffer.alloc(8)), {}), Object.create(filled(Buffer.alloc(8))), null, undefined, 5, "text", {}];
  for (const other of others) {
    for (const way of [
      () => prototype.readUInt16BE.call(other, 1),
      () => prototype.readUInt16BE.apply(other, [1]),
      () => prototype.readUInt16BE.bind(other)(1),
      () => Reflect.apply(prototype.readUInt16BE, other, [1]),
      () => prototype.writeUInt8.call(other, 200, 0),
      () => (other as any).readUInt8(0),
    ]) {
      try {
        out += String(way()) + ",";
      } catch (error) {
        out += told(error) + ",";
      }
    }
  }
  return out;
}
for (let round = 0; round < 3; round++) console.log("on others", digest(onOthers()));
console.log(onOthers().slice(0, 400));

const shadowed = filled(Buffer.alloc(16)) as any;
shadowed.readUInt16LE = () => "own";
console.log(readers.readUInt16LE!(shadowed, [0]), readers.readUInt16LE!(bytes, [0]), readers.readUInt16BE!(shadowed, [0]));
const plain = filled(Buffer.alloc(16));
Object.setPrototypeOf(plain, Uint8Array.prototype);
console.log(readers.readUInt32BE!(plain, [0]), writers.writeUInt8!(plain, [0]).slice(0, 40));
class Derived extends Uint8Array {}
Object.setPrototypeOf(Derived.prototype, Buffer.prototype);
function filledDerived(): Derived {
  const derived = new Derived(16);
  for (let i = 0; i < derived.length; i++) derived[i] = (i * 37 + 129) & 255;
  return derived;
}
function typedLike<T>(model: T, value: unknown): T {
  return value as T;
}
function inTurn(): string {
  const two = [filled(Buffer.alloc(16)), typedLike(bytes, filledDerived())];
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += two[i & 1]!.readUInt16LE(i & 7) + two[i & 1]!.writeUInt8(i & 255, i & 15);
  return sum + " " + two[0]!.toString("hex") + " " + Buffer.from(two[1]!).toString("hex");
}
console.log("in turn", inTurn());
console.log(readers.readUInt32BE!(typedLike(bytes, filledDerived()), [0, 12, 13]));
console.log(String(prototype.readUInt32BE.call(new Uint8Array([1, 2, 3, 4]), 0)), (() => { try { return prototype.readUInt32BE.call({}, 0); } catch (error) { return told(error); } })());
const between = Derived.prototype as any;
const under = typedLike(bytes, filledDerived());
between.readUInt8 = function (this: { length: number }, offset: number) {
  return "replaced " + offset + " " + this.length;
};
console.log(readers.readUInt8!(under, [0, 99]), readers.readUint8!(under, [0, 99]), readers.readInt8!(under, [0, 99]), readers.readUInt8!(bytes, [0, 99]));
delete between.readUInt8;
console.log(readers.readUInt8!(under, [0, 99]));
between.writeInt32BE = undefined;
console.log(writers.writeInt32BE!(under, [0]).slice(0, 60));
delete between.writeInt32BE;
console.log(digest(writers.writeInt32BE!(under, [0])), digest(writers.writeInt32BE!(filled(Buffer.alloc(16)), [0])));
Object.defineProperty(between, "readDoubleBE", { get: () => () => "from a getter", configurable: true });
console.log(readers.readDoubleBE!(under, [0]), readers.readDoubleBE!(bytes, [0]));
all("afterwards");
