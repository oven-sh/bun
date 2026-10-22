// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = SharedArrayBuffer.length;
    console.log("SharedArrayBuffer.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("SharedArrayBuffer.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("SharedArrayBuffer.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = SharedArrayBuffer.name;
    console.log("SharedArrayBuffer.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("SharedArrayBuffer.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = SharedArrayBuffer[Symbol.species];
    console.log("SharedArrayBuffer[Symbol.species], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer[Symbol.species], get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("SharedArrayBuffer[Symbol.species], get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("SharedArrayBuffer[Symbol.species], get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("SharedArrayBuffer[Symbol.species], get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("SharedArrayBuffer[Symbol.species], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.byteLength;
    console.log("SharedArrayBuffer.prototype.byteLength, get, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.byteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("SharedArrayBuffer.prototype.byteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.byteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.byteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(0);
    const result = subject.byteLength;
    console.log("SharedArrayBuffer.prototype.byteLength, get, form 2, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.byteLength, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("SharedArrayBuffer.prototype.byteLength, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.byteLength, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.byteLength, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.grow(16);
    console.log("SharedArrayBuffer.prototype.grow, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.grow:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.grow: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.growable;
    console.log("SharedArrayBuffer.prototype.growable, get, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.growable, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.growable, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.growable, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(0);
    const result = subject.growable;
    console.log("SharedArrayBuffer.prototype.growable, get, form 2, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.growable, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.growable, get, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.growable, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.maxByteLength;
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("SharedArrayBuffer.prototype.maxByteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.maxByteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(0);
    const result = subject.maxByteLength;
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, form 2, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.maxByteLength, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.slice(1, 2);
    console.log("SharedArrayBuffer.prototype.slice, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.slice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.slice, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("SharedArrayBuffer.prototype.slice, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("SharedArrayBuffer.prototype.slice, its own class:", Object.getPrototypeOf(result) === SharedArrayBuffer.prototype, Reflect.getPrototypeOf(result) === SharedArrayBuffer.prototype, result.constructor === SharedArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(SharedArrayBuffer.prototype));
    console.log("SharedArrayBuffer.prototype.slice, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("SharedArrayBuffer.prototype.slice, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("SharedArrayBuffer.prototype.slice, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.slice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(0);
    const result = subject.slice(1, 2);
    console.log("SharedArrayBuffer.prototype.slice, form 2, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype.slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype.slice, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("SharedArrayBuffer.prototype.slice, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("SharedArrayBuffer.prototype.slice, form 2, its own class:", Object.getPrototypeOf(result) === SharedArrayBuffer.prototype, Reflect.getPrototypeOf(result) === SharedArrayBuffer.prototype, result.constructor === SharedArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(SharedArrayBuffer.prototype));
    console.log("SharedArrayBuffer.prototype.slice, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("SharedArrayBuffer.prototype.slice, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("SharedArrayBuffer.prototype.slice, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("SharedArrayBuffer.prototype.slice, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
    const result = subject[Symbol.toStringTag];
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new SharedArrayBuffer(0);
    const result = subject[Symbol.toStringTag];
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("SharedArrayBuffer.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
