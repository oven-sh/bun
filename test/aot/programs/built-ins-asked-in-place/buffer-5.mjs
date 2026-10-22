// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.hexWrite("an", "-", 3.5);
    console.log("Buffer.prototype.hexWrite, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.hexWrite, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.hexWrite, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexWrite, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.hexWrite, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.includes(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.includes, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.includes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.includes, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Buffer.prototype.includes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.includes(first, "-", 3.5, 4.5);
    console.log("Buffer.prototype.includes, form 2, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.includes, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.includes, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Buffer.prototype.includes, form 2: it threw", error instanceof Error);
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
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.includes(first, item, item, item);
    console.log("Buffer.prototype.includes, form 3, is it an operand:", result === subject, result === first, result === item, result === item, result === item);
    console.log("Buffer.prototype.includes, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.includes, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Buffer.prototype.includes, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const first = new Uint8Array(0);
    const result = subject.includes(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.includes, form 4, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.includes, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.includes, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Buffer.prototype.includes, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.indexOf(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.indexOf, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.indexOf, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.indexOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.indexOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.indexOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.indexOf(first, "-", 3.5, 4.5);
    console.log("Buffer.prototype.indexOf, form 2, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.indexOf, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.indexOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.indexOf, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.indexOf, form 2: it threw", error instanceof Error);
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
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.indexOf(first, item, item, item);
    console.log("Buffer.prototype.indexOf, form 3, is it an operand:", result === subject, result === first, result === item, result === item, result === item);
    console.log("Buffer.prototype.indexOf, form 3, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.indexOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.indexOf, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.indexOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const first = new Uint8Array(0);
    const result = subject.indexOf(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.indexOf, form 4, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.indexOf, form 4, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.indexOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.indexOf, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.indexOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.lastIndexOf(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.lastIndexOf, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.lastIndexOf, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.lastIndexOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.lastIndexOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.lastIndexOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.lastIndexOf(first, "-", 3.5, 4.5);
    console.log("Buffer.prototype.lastIndexOf, form 2, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.lastIndexOf, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.lastIndexOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.lastIndexOf, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.lastIndexOf, form 2: it threw", error instanceof Error);
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
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.lastIndexOf(first, item, item, item);
    console.log("Buffer.prototype.lastIndexOf, form 3, is it an operand:", result === subject, result === first, result === item, result === item, result === item);
    console.log("Buffer.prototype.lastIndexOf, form 3, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.lastIndexOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.lastIndexOf, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.lastIndexOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const first = new Uint8Array(0);
    const result = subject.lastIndexOf(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.lastIndexOf, form 4, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.lastIndexOf, form 4, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("Buffer.prototype.lastIndexOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.lastIndexOf, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.lastIndexOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.latin1Slice(1.5, 2.5);
    console.log("Buffer.prototype.latin1Slice, is it an operand:", result === subject);
    console.log("Buffer.prototype.latin1Slice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Slice, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.latin1Slice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.latin1Slice("an", 2.5);
    console.log("Buffer.prototype.latin1Slice, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.latin1Slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Slice, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.latin1Slice, form 2: it threw", error instanceof Error);
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
    const result = subject.latin1Slice(item, item);
    console.log("Buffer.prototype.latin1Slice, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.latin1Slice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Slice, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.latin1Slice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.latin1Slice(1.5, 2.5);
    console.log("Buffer.prototype.latin1Slice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.latin1Slice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Slice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.latin1Slice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.latin1Write("an", 2.5, 3.5);
    console.log("Buffer.prototype.latin1Write, is it an operand:", result === subject);
    console.log("Buffer.prototype.latin1Write, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.latin1Write:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Write, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.latin1Write: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.latin1Write("an", "-", 3.5);
    console.log("Buffer.prototype.latin1Write, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.latin1Write, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.latin1Write, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Write, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.latin1Write, form 2: it threw", error instanceof Error);
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
    const result = subject.latin1Write("an", item, item);
    console.log("Buffer.prototype.latin1Write, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.latin1Write, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.latin1Write, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Write, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.latin1Write, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.latin1Write("an", "-", 3.5);
    console.log("Buffer.prototype.latin1Write, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.latin1Write, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.latin1Write, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.latin1Write, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.latin1Write, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readBigInt64(1);
    console.log("Buffer.prototype.readBigInt64, is it an operand:", result === subject);
    console.log("Buffer.prototype.readBigInt64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Buffer.prototype.readBigInt64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readBigInt64BE(1);
    console.log("Buffer.prototype.readBigInt64BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.readBigInt64BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Buffer.prototype.readBigInt64BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readBigInt64LE(1);
    console.log("Buffer.prototype.readBigInt64LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.readBigInt64LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Buffer.prototype.readBigInt64LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readBigUInt64(1);
    console.log("Buffer.prototype.readBigUInt64, is it an operand:", result === subject);
    console.log("Buffer.prototype.readBigUInt64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Buffer.prototype.readBigUInt64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readBigUInt64BE(1);
    console.log("Buffer.prototype.readBigUInt64BE, is it an operand:", result === subject);
    console.log("Buffer.prototype.readBigUInt64BE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Buffer.prototype.readBigUInt64BE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readBigUInt64LE(1);
    console.log("Buffer.prototype.readBigUInt64LE, is it an operand:", result === subject);
    console.log("Buffer.prototype.readBigUInt64LE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Buffer.prototype.readBigUInt64LE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readDouble(1);
    console.log("Buffer.prototype.readDouble, is it an operand:", result === subject);
    console.log("Buffer.prototype.readDouble:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.readDouble, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.readDouble: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readDoubleBE(1);
    console.log("Buffer.prototype.readDoubleBE, is it an operand:", result === subject);
    console.log("Buffer.prototype.readDoubleBE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.readDoubleBE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.readDoubleBE: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.readDoubleLE(1);
    console.log("Buffer.prototype.readDoubleLE, is it an operand:", result === subject);
    console.log("Buffer.prototype.readDoubleLE:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.readDoubleLE, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.readDoubleLE: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
