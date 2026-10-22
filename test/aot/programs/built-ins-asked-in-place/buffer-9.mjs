// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeFloat(1.5, 2);
    console.log("Buffer.prototype.writeFloat, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeFloat, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeFloat:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeFloat, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeFloat: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeFloatBE(1.5, 2);
    console.log("Buffer.prototype.writeFloatBE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeFloatBE, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeFloatBE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeFloatBE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeFloatBE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeFloatLE(1.5, 2);
    console.log("Buffer.prototype.writeFloatLE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeFloatLE, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeFloatLE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeFloatLE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeFloatLE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeInt16BE(1.5, 2);
    console.log("Buffer.prototype.writeInt16BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeInt16BE, does it lie where its row says:", typeof result !== "number" || (result >= 2 && result <= 4294967296));
    console.log("Buffer.prototype.writeInt16BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeInt16BE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeInt16BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeInt16LE(1.5, 2);
    console.log("Buffer.prototype.writeInt16LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeInt16LE, does it lie where its row says:", typeof result !== "number" || (result >= 2 && result <= 4294967296));
    console.log("Buffer.prototype.writeInt16LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeInt16LE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeInt16LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeInt32BE(1.5, 2);
    console.log("Buffer.prototype.writeInt32BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeInt32BE, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeInt32BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeInt32BE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeInt32BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeInt32LE(1.5, 2);
    console.log("Buffer.prototype.writeInt32LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeInt32LE, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeInt32LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeInt32LE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeInt32LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeInt8(1.5, 2);
    console.log("Buffer.prototype.writeInt8, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeInt8, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeInt8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeInt8, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeInt8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeIntBE(1, 0, 2);
    console.log("Buffer.prototype.writeIntBE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeIntBE, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeIntBE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeIntBE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeIntBE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeIntBE(1.5, 0, 2);
    console.log("Buffer.prototype.writeIntBE, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeIntBE, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeIntBE, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeIntBE, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeIntBE, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeIntLE(1, 0, 2);
    console.log("Buffer.prototype.writeIntLE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeIntLE, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeIntLE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeIntLE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeIntLE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeIntLE(1.5, 0, 2);
    console.log("Buffer.prototype.writeIntLE, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeIntLE, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeIntLE, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeIntLE, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeIntLE, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt16(1.5, 2);
    console.log("Buffer.prototype.writeUInt16, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt16, does it lie where its row says:", typeof result !== "number" || (result >= 2 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt16, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt16BE(1.5, 2);
    console.log("Buffer.prototype.writeUInt16BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt16BE, does it lie where its row says:", typeof result !== "number" || (result >= 2 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt16BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt16BE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt16BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt16LE(1.5, 2);
    console.log("Buffer.prototype.writeUInt16LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt16LE, does it lie where its row says:", typeof result !== "number" || (result >= 2 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt16LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt16LE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt16LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt32(1.5, 2);
    console.log("Buffer.prototype.writeUInt32, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt32, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt32BE(1.5, 2);
    console.log("Buffer.prototype.writeUInt32BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt32BE, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt32BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt32BE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt32BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt32LE(1.5, 2);
    console.log("Buffer.prototype.writeUInt32LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt32LE, does it lie where its row says:", typeof result !== "number" || (result >= 4 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt32LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt32LE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt32LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUInt8(1.5, 2);
    console.log("Buffer.prototype.writeUInt8, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUInt8, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeUInt8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUInt8, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUInt8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUIntBE(1, 0, 2);
    console.log("Buffer.prototype.writeUIntBE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUIntBE, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeUIntBE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUIntBE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUIntBE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUIntBE(1.5, 0, 2);
    console.log("Buffer.prototype.writeUIntBE, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUIntBE, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeUIntBE, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUIntBE, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUIntBE, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUIntLE(1, 0, 2);
    console.log("Buffer.prototype.writeUIntLE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUIntLE, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeUIntLE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUIntLE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUIntLE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeUIntLE(1.5, 0, 2);
    console.log("Buffer.prototype.writeUIntLE, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeUIntLE, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 4294967296));
    console.log("Buffer.prototype.writeUIntLE, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeUIntLE, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeUIntLE, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject[Symbol.toStringTag];
    console.log("Buffer.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Buffer.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject[Symbol.toStringTag];
    console.log("Buffer.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
