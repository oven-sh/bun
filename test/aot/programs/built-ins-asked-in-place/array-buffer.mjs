// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = ArrayBuffer.isView(1.5);
    console.log("ArrayBuffer.isView:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.isView, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.isView: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ArrayBuffer.isView("an");
    console.log("ArrayBuffer.isView, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.isView, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.isView, form 2: it threw", error instanceof Error);
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
    const result = ArrayBuffer.isView(item);
    console.log("ArrayBuffer.isView, form 3, is it an operand:", result === item);
    console.log("ArrayBuffer.isView, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.isView, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.isView, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ArrayBuffer.isView(1.5);
    console.log("ArrayBuffer.isView, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.isView, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.isView, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ArrayBuffer.length;
    console.log("ArrayBuffer.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("ArrayBuffer.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("ArrayBuffer.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ArrayBuffer.name;
    console.log("ArrayBuffer.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("ArrayBuffer.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ArrayBuffer[Symbol.species];
    console.log("ArrayBuffer[Symbol.species], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer[Symbol.species], get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer[Symbol.species], get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer[Symbol.species], get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer[Symbol.species], get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer[Symbol.species], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.byteLength;
    console.log("ArrayBuffer.prototype.byteLength, get, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.byteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("ArrayBuffer.prototype.byteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.byteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.byteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.byteLength;
    console.log("ArrayBuffer.prototype.byteLength, get, form 2, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.byteLength, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("ArrayBuffer.prototype.byteLength, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.byteLength, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.byteLength, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.detached;
    console.log("ArrayBuffer.prototype.detached, get, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.detached, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.detached, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.detached, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.detached;
    console.log("ArrayBuffer.prototype.detached, get, form 2, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.detached, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.detached, get, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.detached, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.maxByteLength;
    console.log("ArrayBuffer.prototype.maxByteLength, get, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.maxByteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("ArrayBuffer.prototype.maxByteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.maxByteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.maxByteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.maxByteLength;
    console.log("ArrayBuffer.prototype.maxByteLength, get, form 2, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.maxByteLength, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("ArrayBuffer.prototype.maxByteLength, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.maxByteLength, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.maxByteLength, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.resizable;
    console.log("ArrayBuffer.prototype.resizable, get, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.resizable, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.resizable, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.resizable, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.resizable;
    console.log("ArrayBuffer.prototype.resizable, get, form 2, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.resizable, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.resizable, get, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("ArrayBuffer.prototype.resizable, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.resize(1);
    console.log("ArrayBuffer.prototype.resize, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.resize:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("ArrayBuffer.prototype.resize: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.slice(1, 2);
    console.log("ArrayBuffer.prototype.slice, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.slice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.slice, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer.prototype.slice, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer.prototype.slice, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("ArrayBuffer.prototype.slice, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ArrayBuffer.prototype.slice, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer.prototype.slice, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer.prototype.slice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.slice(1, 2);
    console.log("ArrayBuffer.prototype.slice, form 2, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype.slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.slice, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer.prototype.slice, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer.prototype.slice, form 2, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("ArrayBuffer.prototype.slice, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ArrayBuffer.prototype.slice, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer.prototype.slice, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer.prototype.slice, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.transfer(1);
    console.log("ArrayBuffer.prototype.transfer, is it an operand:", result === subject);
    const again = subject.transfer(1);
    console.log("ArrayBuffer.prototype.transfer, does a second call answer the same thing:", result === again);
    console.log("ArrayBuffer.prototype.transfer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.transfer, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer.prototype.transfer, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer.prototype.transfer, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("ArrayBuffer.prototype.transfer, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ArrayBuffer.prototype.transfer, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer.prototype.transfer, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer.prototype.transfer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.transfer(1);
    console.log("ArrayBuffer.prototype.transfer, form 2, is it an operand:", result === subject);
    const again = subject.transfer(1);
    console.log("ArrayBuffer.prototype.transfer, form 2, does a second call answer the same thing:", result === again);
    console.log("ArrayBuffer.prototype.transfer, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.transfer, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer.prototype.transfer, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer.prototype.transfer, form 2, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("ArrayBuffer.prototype.transfer, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ArrayBuffer.prototype.transfer, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer.prototype.transfer, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer.prototype.transfer, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.transferToFixedLength(1);
    console.log("ArrayBuffer.prototype.transferToFixedLength, is it an operand:", result === subject);
    const again = subject.transferToFixedLength(1);
    console.log("ArrayBuffer.prototype.transferToFixedLength, does a second call answer the same thing:", result === again);
    console.log("ArrayBuffer.prototype.transferToFixedLength:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.transferToFixedLength, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer.prototype.transferToFixedLength, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer.prototype.transferToFixedLength, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("ArrayBuffer.prototype.transferToFixedLength, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ArrayBuffer.prototype.transferToFixedLength, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer.prototype.transferToFixedLength, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer.prototype.transferToFixedLength: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject.transferToFixedLength(1);
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, is it an operand:", result === subject);
    const again = subject.transferToFixedLength(1);
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, does a second call answer the same thing:", result === again);
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ArrayBuffer.prototype.transferToFixedLength, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject[Symbol.toStringTag];
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new ArrayBuffer(0);
    const result = subject[Symbol.toStringTag];
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("ArrayBuffer.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
