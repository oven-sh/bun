// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Bun.MD4.byteLength;
    console.log("Bun.MD4.byteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.MD4.byteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.byteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.MD4.byteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = new DataView(new ArrayBuffer(16));
    const result = Bun.MD4.hash(first, second);
    console.log("Bun.MD4.hash, is it an operand:", result === first, result === second);
    console.log("Bun.MD4.hash:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.hash, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.MD4.hash, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.MD4.hash, its own class:", Object.getPrototypeOf(result) === DataView.prototype, Reflect.getPrototypeOf(result) === DataView.prototype, result.constructor === DataView, Object.getPrototypeOf(result) === Object.getPrototypeOf(DataView.prototype));
    console.log("Bun.MD4.hash, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.MD4.hash, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.MD4.hash, how many keys:", Object.keys(result).length);
    console.log("Bun.MD4.hash, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.MD4.hash, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Bun.MD4.hash: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = new DataView(new ArrayBuffer(16));
    const result = Bun.MD4.hash(first, second);
    console.log("Bun.MD4.hash, form 2, is it an operand:", result === first, result === second);
    console.log("Bun.MD4.hash, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.hash, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.MD4.hash, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.MD4.hash, form 2, its own class:", Object.getPrototypeOf(result) === DataView.prototype, Reflect.getPrototypeOf(result) === DataView.prototype, result.constructor === DataView, Object.getPrototypeOf(result) === Object.getPrototypeOf(DataView.prototype));
    console.log("Bun.MD4.hash, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.MD4.hash, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.MD4.hash, form 2, how many keys:", Object.keys(result).length);
    console.log("Bun.MD4.hash, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.MD4.hash, form 2, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Bun.MD4.hash, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const second = new DataView(new ArrayBuffer(16));
    const result = Bun.MD4.hash(first, second);
    console.log("Bun.MD4.hash, form 3, is it an operand:", result === first, result === second);
    console.log("Bun.MD4.hash, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.hash, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.MD4.hash, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.MD4.hash, form 3, its own class:", Object.getPrototypeOf(result) === DataView.prototype, Reflect.getPrototypeOf(result) === DataView.prototype, result.constructor === DataView, Object.getPrototypeOf(result) === Object.getPrototypeOf(DataView.prototype));
    console.log("Bun.MD4.hash, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.MD4.hash, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.MD4.hash, form 3, how many keys:", Object.keys(result).length);
    console.log("Bun.MD4.hash, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.MD4.hash, form 3, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Bun.MD4.hash, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.MD4();
    const result = subject.byteLength;
    console.log("Bun.MD4.prototype.byteLength, get, is it an operand:", result === subject);
    console.log("Bun.MD4.prototype.byteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.MD4.prototype.byteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.prototype.byteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.MD4.prototype.byteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.MD4();
    const first = new DataView(new ArrayBuffer(16));
    const result = subject.digest(first);
    console.log("Bun.MD4.prototype.digest, is it an operand:", result === subject, result === first);
    console.log("Bun.MD4.prototype.digest:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.prototype.digest, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.MD4.prototype.digest, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.MD4.prototype.digest, its own class:", Object.getPrototypeOf(result) === DataView.prototype, Reflect.getPrototypeOf(result) === DataView.prototype, result.constructor === DataView, Object.getPrototypeOf(result) === Object.getPrototypeOf(DataView.prototype));
    console.log("Bun.MD4.prototype.digest, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.MD4.prototype.digest, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.MD4.prototype.digest, how many keys:", Object.keys(result).length);
    console.log("Bun.MD4.prototype.digest, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.MD4.prototype.digest, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Bun.MD4.prototype.digest: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.MD4();
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.update(first);
    console.log("Bun.MD4.prototype.update, is it an operand:", result === subject, result === first);
    console.log("Bun.MD4.prototype.update:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.prototype.update, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.MD4.prototype.update, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.MD4.prototype.update, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.MD4.prototype.update, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.MD4.prototype.update, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.MD4.prototype.update: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.MD4();
    const first = new ArrayBuffer(0);
    const result = subject.update(first);
    console.log("Bun.MD4.prototype.update, form 2, is it an operand:", result === subject, result === first);
    console.log("Bun.MD4.prototype.update, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.MD4.prototype.update, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.MD4.prototype.update, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.MD4.prototype.update, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.MD4.prototype.update, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.MD4.prototype.update, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.MD4.prototype.update, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
