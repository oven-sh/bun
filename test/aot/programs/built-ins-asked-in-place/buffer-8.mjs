// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.ucs2Slice(1.5, 2.5);
    console.log("Buffer.prototype.ucs2Slice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.ucs2Slice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.ucs2Slice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.ucs2Slice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.ucs2Write("an", 2.5, 3.5);
    console.log("Buffer.prototype.ucs2Write, is it an operand:", result === subject);
    console.log("Buffer.prototype.ucs2Write, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.ucs2Write:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.ucs2Write, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.ucs2Write: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.ucs2Write("an", "-", 3.5);
    console.log("Buffer.prototype.ucs2Write, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.ucs2Write, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.ucs2Write, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.ucs2Write, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.ucs2Write, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.ucs2Write("an", item, item);
    console.log("Buffer.prototype.ucs2Write, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.ucs2Write, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.ucs2Write, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.ucs2Write, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.ucs2Write, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.ucs2Write("an", "-", 3.5);
    console.log("Buffer.prototype.ucs2Write, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.ucs2Write, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.ucs2Write, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.ucs2Write, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.ucs2Write, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf16leSlice(1.5, 2.5);
    console.log("Buffer.prototype.utf16leSlice, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf16leSlice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leSlice, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf16leSlice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf16leSlice("an", 2.5);
    console.log("Buffer.prototype.utf16leSlice, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf16leSlice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leSlice, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf16leSlice, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf16leSlice(item, item);
    console.log("Buffer.prototype.utf16leSlice, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.utf16leSlice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leSlice, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf16leSlice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.utf16leSlice(1.5, 2.5);
    console.log("Buffer.prototype.utf16leSlice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf16leSlice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leSlice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf16leSlice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf16leWrite("an", 2.5, 3.5);
    console.log("Buffer.prototype.utf16leWrite, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf16leWrite, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf16leWrite:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leWrite, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf16leWrite: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf16leWrite("an", "-", 3.5);
    console.log("Buffer.prototype.utf16leWrite, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf16leWrite, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf16leWrite, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leWrite, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf16leWrite, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf16leWrite("an", item, item);
    console.log("Buffer.prototype.utf16leWrite, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.utf16leWrite, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf16leWrite, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leWrite, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf16leWrite, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.utf16leWrite("an", "-", 3.5);
    console.log("Buffer.prototype.utf16leWrite, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf16leWrite, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf16leWrite, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf16leWrite, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf16leWrite, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf8Slice(1.5, 2.5);
    console.log("Buffer.prototype.utf8Slice, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf8Slice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Slice, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf8Slice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf8Slice("an", 2.5);
    console.log("Buffer.prototype.utf8Slice, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf8Slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Slice, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf8Slice, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf8Slice(item, item);
    console.log("Buffer.prototype.utf8Slice, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.utf8Slice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Slice, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf8Slice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.utf8Slice(1.5, 2.5);
    console.log("Buffer.prototype.utf8Slice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf8Slice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Slice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.utf8Slice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf8Write("an", 2.5, 3.5);
    console.log("Buffer.prototype.utf8Write, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf8Write, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf8Write:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Write, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf8Write: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf8Write("an", "-", 3.5);
    console.log("Buffer.prototype.utf8Write, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf8Write, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf8Write, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Write, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf8Write, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.utf8Write("an", item, item);
    console.log("Buffer.prototype.utf8Write, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.utf8Write, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf8Write, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Write, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf8Write, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.utf8Write("an", "-", 3.5);
    console.log("Buffer.prototype.utf8Write, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.utf8Write, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.utf8Write, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.utf8Write, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.utf8Write, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.write("an", 2);
    console.log("Buffer.prototype.write, is it an operand:", result === subject);
    console.log("Buffer.prototype.write, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.write:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.write, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.write: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.write("an", 0);
    console.log("Buffer.prototype.write, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.write, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.write, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.write, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.write, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeBigInt64BE(5n, 2);
    console.log("Buffer.prototype.writeBigInt64BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeBigInt64BE, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeBigInt64BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeBigInt64BE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeBigInt64BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeBigInt64LE(5n, 2);
    console.log("Buffer.prototype.writeBigInt64LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeBigInt64LE, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeBigInt64LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeBigInt64LE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeBigInt64LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeBigUInt64BE(5n, 2);
    console.log("Buffer.prototype.writeBigUInt64BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeBigUInt64BE, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeBigUInt64BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeBigUInt64BE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeBigUInt64BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeBigUInt64LE(5n, 2);
    console.log("Buffer.prototype.writeBigUInt64LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeBigUInt64LE, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeBigUInt64LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeBigUInt64LE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeBigUInt64LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeDouble(1.5, 2);
    console.log("Buffer.prototype.writeDouble, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeDouble, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeDouble:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeDouble, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeDouble: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeDoubleBE(1.5, 2);
    console.log("Buffer.prototype.writeDoubleBE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeDoubleBE, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeDoubleBE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeDoubleBE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeDoubleBE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.writeDoubleLE(1.5, 2);
    console.log("Buffer.prototype.writeDoubleLE, is it an operand:", result === subject);
    console.log("Buffer.prototype.writeDoubleLE, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 4294967296));
    console.log("Buffer.prototype.writeDoubleLE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.writeDoubleLE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.writeDoubleLE: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
