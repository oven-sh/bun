// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new TextDecoder();
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.decode(first, null);
    console.log("TextDecoder.prototype.decode, is it an operand:", result === subject, result === first);
    console.log("TextDecoder.prototype.decode:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.decode, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.decode: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextDecoder();
    const first = new ArrayBuffer(0);
    const result = subject.decode(first, null);
    console.log("TextDecoder.prototype.decode, form 2, is it an operand:", result === subject, result === first);
    console.log("TextDecoder.prototype.decode, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.decode, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.decode, form 2: it threw", error instanceof Error);
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
    const subject = new TextDecoder();
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.decode(first, second);
    console.log("TextDecoder.prototype.decode, form 3, is it an operand:", result === subject, result === first, result === second);
    console.log("TextDecoder.prototype.decode, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.decode, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.decode, form 3: it threw", error instanceof Error);
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
    const subject = new TextDecoder();
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = [1.5, item, "two"];
    const result = subject.decode(first, second);
    console.log("TextDecoder.prototype.decode, form 4, is it an operand:", result === subject, result === first, result === second);
    console.log("TextDecoder.prototype.decode, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.decode, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.decode, form 4: it threw", error instanceof Error);
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
    const subject = new TextDecoder();
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.decode(first, item);
    console.log("TextDecoder.prototype.decode, form 5, is it an operand:", result === subject, result === first, result === item);
    console.log("TextDecoder.prototype.decode, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.decode, form 5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.decode, form 5: it threw", error instanceof Error);
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
    const subject = new TextDecoder();
    const first = new ArrayBuffer(0);
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.decode(first, second);
    console.log("TextDecoder.prototype.decode, form 6, is it an operand:", result === subject, result === first, result === second);
    console.log("TextDecoder.prototype.decode, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.decode, form 6, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.decode, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextDecoder();
    const result = subject.encoding;
    console.log("TextDecoder.prototype.encoding, get, is it an operand:", result === subject);
    console.log("TextDecoder.prototype.encoding, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.encoding, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextDecoder.prototype.encoding, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextDecoder();
    const result = subject.fatal;
    console.log("TextDecoder.prototype.fatal, get, is it an operand:", result === subject);
    console.log("TextDecoder.prototype.fatal, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.fatal, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("TextDecoder.prototype.fatal, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextDecoder();
    const result = subject.ignoreBOM;
    console.log("TextDecoder.prototype.ignoreBOM, get, is it an operand:", result === subject);
    console.log("TextDecoder.prototype.ignoreBOM, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextDecoder.prototype.ignoreBOM, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("TextDecoder.prototype.ignoreBOM, get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
