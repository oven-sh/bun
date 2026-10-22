// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64Slice("an", 2.5);
    console.log("Buffer.prototype.base64Slice, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64Slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Slice, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64Slice, form 2: it threw", error instanceof Error);
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
    const result = subject.base64Slice(item, item);
    console.log("Buffer.prototype.base64Slice, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.base64Slice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Slice, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64Slice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.base64Slice(1.5, 2.5);
    console.log("Buffer.prototype.base64Slice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64Slice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Slice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64Slice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64Write("an", 2.5, 3.5);
    console.log("Buffer.prototype.base64Write, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64Write, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64Write:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Write, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64Write: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64Write("an", "-", 3.5);
    console.log("Buffer.prototype.base64Write, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64Write, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64Write, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Write, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64Write, form 2: it threw", error instanceof Error);
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
    const result = subject.base64Write("an", item, item);
    console.log("Buffer.prototype.base64Write, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.base64Write, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64Write, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Write, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64Write, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.base64Write("an", "-", 3.5);
    console.log("Buffer.prototype.base64Write, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64Write, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64Write, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64Write, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64Write, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64urlSlice(1.5, 2.5);
    console.log("Buffer.prototype.base64urlSlice, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64urlSlice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlSlice, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64urlSlice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64urlSlice("an", 2.5);
    console.log("Buffer.prototype.base64urlSlice, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64urlSlice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlSlice, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64urlSlice, form 2: it threw", error instanceof Error);
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
    const result = subject.base64urlSlice(item, item);
    console.log("Buffer.prototype.base64urlSlice, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.base64urlSlice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlSlice, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64urlSlice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.base64urlSlice(1.5, 2.5);
    console.log("Buffer.prototype.base64urlSlice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64urlSlice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlSlice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.base64urlSlice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64urlWrite("an", 2.5, 3.5);
    console.log("Buffer.prototype.base64urlWrite, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64urlWrite, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64urlWrite:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlWrite, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64urlWrite: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.base64urlWrite("an", "-", 3.5);
    console.log("Buffer.prototype.base64urlWrite, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64urlWrite, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64urlWrite, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlWrite, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64urlWrite, form 2: it threw", error instanceof Error);
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
    const result = subject.base64urlWrite("an", item, item);
    console.log("Buffer.prototype.base64urlWrite, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.base64urlWrite, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64urlWrite, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlWrite, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64urlWrite, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.base64urlWrite("an", "-", 3.5);
    console.log("Buffer.prototype.base64urlWrite, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.base64urlWrite, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.base64urlWrite, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.base64urlWrite, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.base64urlWrite, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.compare(first, 2);
    console.log("Buffer.prototype.compare, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.compare, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("Buffer.prototype.compare:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.compare, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.compare: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const first = new Uint8Array(0);
    const result = subject.compare(first, 2);
    console.log("Buffer.prototype.compare, form 2, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.compare, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("Buffer.prototype.compare, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.compare, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.compare, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.copy(first, 2.5, 3.5, 4.5);
    console.log("Buffer.prototype.copy, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.copy, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.copy:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.copy, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.copy: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.copy(first, "-", 3.5, 4.5);
    console.log("Buffer.prototype.copy, form 2, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.copy, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.copy, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.copy, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.copy, form 2: it threw", error instanceof Error);
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
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.copy(first, item, item, item);
    console.log("Buffer.prototype.copy, form 3, is it an operand:", result === subject, result === first, result === item, result === item, result === item);
    console.log("Buffer.prototype.copy, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.copy, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.copy, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.copy, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.copy(first, 2.5, "x", 4.5);
    console.log("Buffer.prototype.copy, form 4, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.copy, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.copy, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.copy, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.copy, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.equals(first);
    console.log("Buffer.prototype.equals, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.equals:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.equals, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Buffer.prototype.equals: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.equals(first);
    console.log("Buffer.prototype.equals, form 2, is it an operand:", result === subject, result === first);
    console.log("Buffer.prototype.equals, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.equals, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Buffer.prototype.equals, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.hexSlice(1.5, 2.5);
    console.log("Buffer.prototype.hexSlice, is it an operand:", result === subject);
    console.log("Buffer.prototype.hexSlice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexSlice, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.hexSlice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.hexSlice("an", 2.5);
    console.log("Buffer.prototype.hexSlice, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.hexSlice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexSlice, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.hexSlice, form 2: it threw", error instanceof Error);
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
    const result = subject.hexSlice(item, item);
    console.log("Buffer.prototype.hexSlice, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.hexSlice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexSlice, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.hexSlice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.alloc(0);
    const result = subject.hexSlice(1.5, 2.5);
    console.log("Buffer.prototype.hexSlice, form 4, is it an operand:", result === subject);
    console.log("Buffer.prototype.hexSlice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexSlice, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Buffer.prototype.hexSlice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.hexWrite("an", 2.5, 3.5);
    console.log("Buffer.prototype.hexWrite, is it an operand:", result === subject);
    console.log("Buffer.prototype.hexWrite, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.hexWrite:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexWrite, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.hexWrite: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Buffer.from("banana and more text, 24");
    const result = subject.hexWrite("an", "-", 3.5);
    console.log("Buffer.prototype.hexWrite, form 2, is it an operand:", result === subject);
    console.log("Buffer.prototype.hexWrite, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.hexWrite, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexWrite, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.hexWrite, form 2: it threw", error instanceof Error);
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
    const result = subject.hexWrite("an", item, item);
    console.log("Buffer.prototype.hexWrite, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Buffer.prototype.hexWrite, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Buffer.prototype.hexWrite, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Buffer.prototype.hexWrite, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Buffer.prototype.hexWrite, form 3: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
