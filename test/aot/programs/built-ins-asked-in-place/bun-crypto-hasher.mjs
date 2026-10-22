// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Bun.CryptoHasher.algorithms;
    console.log("Bun.CryptoHasher.algorithms, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.algorithms, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.algorithms, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.algorithms, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.algorithms, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.algorithms, get, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.algorithms, get, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.algorithms, get, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.algorithms, get, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.CryptoHasher.algorithms, get, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.CryptoHasher.algorithms, get, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.algorithms, get, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.CryptoHasher.algorithms, get, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.CryptoHasher.algorithms, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const result = subject.algorithm;
    console.log("Bun.CryptoHasher.prototype.algorithm, get, is it an operand:", result === subject);
    console.log("Bun.CryptoHasher.prototype.algorithm, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.algorithm, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.algorithm, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const result = subject.byteLength;
    console.log("Bun.CryptoHasher.prototype.byteLength, get, is it an operand:", result === subject);
    console.log("Bun.CryptoHasher.prototype.byteLength, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.CryptoHasher.prototype.byteLength, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.byteLength, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.byteLength, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const result = subject.copy();
    console.log("Bun.CryptoHasher.prototype.copy, is it an operand:", result === subject);
    console.log("Bun.CryptoHasher.prototype.copy:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.copy, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.prototype.copy, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.prototype.copy, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.prototype.copy, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.prototype.copy, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.copy: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const result = subject.digest(null);
    console.log("Bun.CryptoHasher.prototype.digest, is it an operand:", result === subject);
    console.log("Bun.CryptoHasher.prototype.digest:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.digest, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.prototype.digest, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.prototype.digest, its own class:", Object.getPrototypeOf(result) === Buffer.prototype, Reflect.getPrototypeOf(result) === Buffer.prototype, result.constructor === Buffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(Buffer.prototype));
    console.log("Bun.CryptoHasher.prototype.digest, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.prototype.digest, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.prototype.digest, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.prototype.digest, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.prototype.digest, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.prototype.digest, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.CryptoHasher.prototype.digest, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.CryptoHasher.prototype.digest, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.CryptoHasher.prototype.digest, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.CryptoHasher.prototype.digest, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.digest: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const result = subject.update("banana", "-");
    console.log("Bun.CryptoHasher.prototype.update, is it an operand:", result === subject);
    console.log("Bun.CryptoHasher.prototype.update:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.update, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.prototype.update, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.prototype.update, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.prototype.update, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.prototype.update, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.update: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const result = subject.update("", "-");
    console.log("Bun.CryptoHasher.prototype.update, form 2, is it an operand:", result === subject);
    console.log("Bun.CryptoHasher.prototype.update, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.update, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.prototype.update, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.prototype.update, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.prototype.update, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.prototype.update, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.update, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = subject.update(first);
    console.log("Bun.CryptoHasher.prototype.update, form 3, is it an operand:", result === subject, result === first);
    console.log("Bun.CryptoHasher.prototype.update, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.update, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.prototype.update, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.prototype.update, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.prototype.update, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.prototype.update, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.update, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.CryptoHasher("sha256");
    const first = new ArrayBuffer(0);
    const result = subject.update(first);
    console.log("Bun.CryptoHasher.prototype.update, form 4, is it an operand:", result === subject, result === first);
    console.log("Bun.CryptoHasher.prototype.update, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.CryptoHasher.prototype.update, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.CryptoHasher.prototype.update, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.CryptoHasher.prototype.update, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.CryptoHasher.prototype.update, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.CryptoHasher.prototype.update, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.CryptoHasher.prototype.update, form 4: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
