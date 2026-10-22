// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = DataView.length;
    console.log("DataView.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("DataView.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = DataView.name;
    console.log("DataView.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DataView.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.buffer;
    console.log("DataView.prototype.buffer, get, is it an operand:", result === subject);
    console.log("DataView.prototype.buffer, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.buffer, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("DataView.prototype.buffer, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("DataView.prototype.buffer, get, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("DataView.prototype.buffer, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("DataView.prototype.buffer, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("DataView.prototype.buffer, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("DataView.prototype.buffer, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.byteLength;
    console.log("DataView.prototype.byteLength, get, is it an operand:", result === subject);
    console.log("DataView.prototype.byteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("DataView.prototype.byteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.byteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.byteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.byteOffset;
    console.log("DataView.prototype.byteOffset, get, is it an operand:", result === subject);
    console.log("DataView.prototype.byteOffset, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("DataView.prototype.byteOffset, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.byteOffset, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.byteOffset, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getBigInt64(1, true);
    console.log("DataView.prototype.getBigInt64, is it an operand:", result === subject);
    console.log("DataView.prototype.getBigInt64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.getBigInt64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getBigUint64(1, true);
    console.log("DataView.prototype.getBigUint64, is it an operand:", result === subject);
    console.log("DataView.prototype.getBigUint64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.getBigUint64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getFloat16(1, true);
    console.log("DataView.prototype.getFloat16, is it an operand:", result === subject);
    console.log("DataView.prototype.getFloat16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getFloat16, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getFloat16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getFloat32(1, true);
    console.log("DataView.prototype.getFloat32, is it an operand:", result === subject);
    console.log("DataView.prototype.getFloat32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getFloat32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getFloat32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getFloat64(1, true);
    console.log("DataView.prototype.getFloat64, is it an operand:", result === subject);
    console.log("DataView.prototype.getFloat64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getFloat64, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getFloat64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getInt16(1, true);
    console.log("DataView.prototype.getInt16, is it an operand:", result === subject);
    console.log("DataView.prototype.getInt16, does it lie where its row says:", typeof result !== "number" || (result >= -32768 && result <= 32767));
    console.log("DataView.prototype.getInt16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getInt16, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getInt16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getInt32(1, true);
    console.log("DataView.prototype.getInt32, is it an operand:", result === subject);
    console.log("DataView.prototype.getInt32, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 2147483647));
    console.log("DataView.prototype.getInt32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getInt32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getInt32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getInt8(1);
    console.log("DataView.prototype.getInt8, is it an operand:", result === subject);
    console.log("DataView.prototype.getInt8, does it lie where its row says:", typeof result !== "number" || (result >= -128 && result <= 127));
    console.log("DataView.prototype.getInt8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getInt8, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getInt8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getUint16(1, true);
    console.log("DataView.prototype.getUint16, is it an operand:", result === subject);
    console.log("DataView.prototype.getUint16, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 65535));
    console.log("DataView.prototype.getUint16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getUint16, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getUint16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getUint32(1, true);
    console.log("DataView.prototype.getUint32, is it an operand:", result === subject);
    console.log("DataView.prototype.getUint32, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("DataView.prototype.getUint32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getUint32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getUint32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.getUint8(1);
    console.log("DataView.prototype.getUint8, is it an operand:", result === subject);
    console.log("DataView.prototype.getUint8, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 255));
    console.log("DataView.prototype.getUint8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype.getUint8, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DataView.prototype.getUint8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setBigInt64(1, 5n, true);
    console.log("DataView.prototype.setBigInt64, is it an operand:", result === subject);
    console.log("DataView.prototype.setBigInt64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setBigInt64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setBigUint64(1, 5n, true);
    console.log("DataView.prototype.setBigUint64, is it an operand:", result === subject);
    console.log("DataView.prototype.setBigUint64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setBigUint64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setFloat16(1, 2.5, true);
    console.log("DataView.prototype.setFloat16, is it an operand:", result === subject);
    console.log("DataView.prototype.setFloat16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setFloat16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setFloat32(1, 2.5, true);
    console.log("DataView.prototype.setFloat32, is it an operand:", result === subject);
    console.log("DataView.prototype.setFloat32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setFloat32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setFloat64(1, 2.5, true);
    console.log("DataView.prototype.setFloat64, is it an operand:", result === subject);
    console.log("DataView.prototype.setFloat64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setFloat64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setInt16(1, 2.5, true);
    console.log("DataView.prototype.setInt16, is it an operand:", result === subject);
    console.log("DataView.prototype.setInt16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setInt16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setInt32(1, 2.5, true);
    console.log("DataView.prototype.setInt32, is it an operand:", result === subject);
    console.log("DataView.prototype.setInt32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setInt32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setInt8(1, 2.5);
    console.log("DataView.prototype.setInt8, is it an operand:", result === subject);
    console.log("DataView.prototype.setInt8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setInt8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setUint16(1, 2.5, true);
    console.log("DataView.prototype.setUint16, is it an operand:", result === subject);
    console.log("DataView.prototype.setUint16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setUint16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setUint32(1, 2.5, true);
    console.log("DataView.prototype.setUint32, is it an operand:", result === subject);
    console.log("DataView.prototype.setUint32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setUint32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject.setUint8(1, 2.5);
    console.log("DataView.prototype.setUint8, is it an operand:", result === subject);
    console.log("DataView.prototype.setUint8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DataView.prototype.setUint8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DataView(new ArrayBuffer(16));
    const result = subject[Symbol.toStringTag];
    console.log("DataView.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("DataView.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DataView.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DataView.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
