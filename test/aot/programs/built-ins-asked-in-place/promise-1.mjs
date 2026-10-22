// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Promise.all(1.5);
    const again = Promise.all(1.5);
    console.log("Promise.all, does a second call answer the same thing:", result === again);
    console.log("Promise.all:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.all, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.all, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.all, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.all, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.all, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.all, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.all: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.all("an");
    const again = Promise.all("an");
    console.log("Promise.all, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.all, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.all, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.all, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.all, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.all, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.all, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.all, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.all, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.all, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.all, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.all, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.all, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.all, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.all, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.all, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.all, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.all, form 2, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Promise.all, form 2, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Promise.all, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Promise.all, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Promise.all, form 2: it threw", error instanceof Error);
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
    const result = Promise.all(item);
    console.log("Promise.all, form 3, is it an operand:", result === item);
    const again = Promise.all(item);
    console.log("Promise.all, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.all, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.all, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.all, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.all, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.all, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.all, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.all, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.all, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.all(1.5);
    const again = Promise.all(1.5);
    console.log("Promise.all, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.all, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.all, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.all, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.all, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.all, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.all, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.all, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.all, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.allSettled(1.5);
    const again = Promise.allSettled(1.5);
    console.log("Promise.allSettled, does a second call answer the same thing:", result === again);
    console.log("Promise.allSettled:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.allSettled, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.allSettled, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.allSettled, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.allSettled, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.allSettled, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.allSettled, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.allSettled: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.allSettled("an");
    const again = Promise.allSettled("an");
    console.log("Promise.allSettled, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.allSettled, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.allSettled, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.allSettled, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.allSettled, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.allSettled, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.allSettled, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.allSettled, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.allSettled, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.allSettled, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.allSettled, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.allSettled, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.allSettled, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.allSettled, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.allSettled, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.allSettled, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.allSettled, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.allSettled, form 2, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Promise.allSettled, form 2, settled, its length:", settled.length === 0, settled.length);
      console.log("Promise.allSettled, form 2, settled[0]:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Promise.allSettled, form 2, settled[0], the class:", Array.isArray(settled[0]), settled[0] instanceof Object, settled[0] instanceof Array, settled[0] instanceof Map, settled[0] instanceof Set, settled[0] instanceof Promise, settled[0] instanceof Date, settled[0] instanceof RegExp, settled[0] instanceof Error, settled[0] instanceof ArrayBuffer, settled[0] instanceof Uint8Array, settled[0] instanceof Function, ArrayBuffer.isView(settled[0]));
      console.log("Promise.allSettled, form 2, settled[0], above it:", Object.getPrototypeOf(settled[0]) === Object.prototype, Object.getPrototypeOf(settled[0]) === Array.prototype, Object.getPrototypeOf(settled[0]) === null);
      console.log("Promise.allSettled, form 2, settled[0], its state:", Object.isFrozen(settled[0]), Object.isSealed(settled[0]), Object.isExtensible(settled[0]));
      console.log("Promise.allSettled, form 2, settled[0], names in it:", "length" in settled[0], "size" in settled[0], "then" in settled[0], "next" in settled[0], "constructor" in settled[0], Symbol.iterator in settled[0]);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Promise.allSettled, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Promise.allSettled, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Promise.allSettled, form 2: it threw", error instanceof Error);
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
    const result = Promise.allSettled(item);
    console.log("Promise.allSettled, form 3, is it an operand:", result === item);
    const again = Promise.allSettled(item);
    console.log("Promise.allSettled, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.allSettled, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.allSettled, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.allSettled, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.allSettled, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.allSettled, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.allSettled, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.allSettled, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.allSettled, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.allSettled(1.5);
    const again = Promise.allSettled(1.5);
    console.log("Promise.allSettled, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.allSettled, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.allSettled, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.allSettled, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.allSettled, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.allSettled, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.allSettled, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.allSettled, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.allSettled, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.any(1.5);
    const again = Promise.any(1.5);
    console.log("Promise.any, does a second call answer the same thing:", result === again);
    console.log("Promise.any:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.any, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.any, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.any, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.any, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.any, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.any, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.any: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.any("an");
    const again = Promise.any("an");
    console.log("Promise.any, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.any, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.any, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.any, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.any, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.any, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.any, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.any, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.any, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.any, form 2, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Promise.any, form 2: it threw", error instanceof Error);
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
    const result = Promise.any(item);
    console.log("Promise.any, form 3, is it an operand:", result === item);
    const again = Promise.any(item);
    console.log("Promise.any, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.any, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.any, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.any, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.any, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.any, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.any, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.any, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.any, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.any(1.5);
    const again = Promise.any(1.5);
    console.log("Promise.any, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.any, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.any, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.any, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.any, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.any, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.any, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.any, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.any, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.length;
    console.log("Promise.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Promise.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Promise.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.name;
    console.log("Promise.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Promise.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.race(1.5);
    const again = Promise.race(1.5);
    console.log("Promise.race, does a second call answer the same thing:", result === again);
    console.log("Promise.race:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.race, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.race, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.race, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.race, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.race, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.race, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.race: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.race("an");
    const again = Promise.race("an");
    console.log("Promise.race, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.race, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.race, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.race, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.race, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.race, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.race, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.race, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.race, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.race, form 2, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Promise.race, form 2: it threw", error instanceof Error);
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
    const result = Promise.race(item);
    console.log("Promise.race, form 3, is it an operand:", result === item);
    const again = Promise.race(item);
    console.log("Promise.race, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.race, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.race, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.race, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.race, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.race, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.race, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.race, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.race, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.race(1.5);
    const again = Promise.race(1.5);
    console.log("Promise.race, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.race, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.race, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.race, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.race, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.race, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.race, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.race, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.race, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.reject(1.5);
    const again = Promise.reject(1.5);
    console.log("Promise.reject, does a second call answer the same thing:", result === again);
    console.log("Promise.reject:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.reject, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.reject, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.reject, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.reject, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.reject, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.reject, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.reject: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.reject("an");
    const again = Promise.reject("an");
    console.log("Promise.reject, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.reject, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.reject, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.reject, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.reject, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.reject, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.reject, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.reject, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.reject, form 2: it threw", error instanceof Error);
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
    const result = Promise.reject(item);
    console.log("Promise.reject, form 3, is it an operand:", result === item);
    const again = Promise.reject(item);
    console.log("Promise.reject, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.reject, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.reject, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.reject, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.reject, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.reject, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.reject, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.reject, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.reject, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.reject(1.5);
    const again = Promise.reject(1.5);
    console.log("Promise.reject, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.reject, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.reject, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.reject, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.reject, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.reject, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.reject, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.reject, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.reject, form 4: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve(first);
    console.log("Promise.resolve, is it an operand:", result === first);
    console.log("Promise.resolve:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve.call(Promise, first);
    console.log("Promise.resolve, by call, is it an operand:", result === first);
    console.log("Promise.resolve, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, by call, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, by call, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, by call, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, by call, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, by call, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, by call, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, by call, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, by call, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by call, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by call, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by call, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, by call, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, by call, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, by call: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve.apply(Promise, [first]);
    console.log("Promise.resolve, by apply, is it an operand:", result === first);
    console.log("Promise.resolve, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, by apply, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, by apply, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, by apply, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, by apply, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, by apply, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, by apply, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, by apply, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, by apply, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by apply, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by apply, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by apply, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, by apply, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, by apply, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, by apply: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Reflect.apply(Promise.resolve, Promise, [first]);
    console.log("Promise.resolve, by Reflect.apply, is it an operand:", result === first);
    console.log("Promise.resolve, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, by Reflect.apply, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, by Reflect.apply, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, by Reflect.apply, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, by Reflect.apply, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, by Reflect.apply, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, by Reflect.apply, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by Reflect.apply, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by Reflect.apply, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by Reflect.apply, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, by Reflect.apply, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, by Reflect.apply, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, by Reflect.apply: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve.bind(Promise)(first);
    console.log("Promise.resolve, by a bound function, is it an operand:", result === first);
    console.log("Promise.resolve, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, by a bound function, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, by a bound function, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, by a bound function, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, by a bound function, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, by a bound function, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, by a bound function, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, by a bound function, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, by a bound function, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by a bound function, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by a bound function, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, by a bound function, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, by a bound function, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, by a bound function, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, by a bound function: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve(first);
    console.log("Promise.resolve, form 6, is it an operand:", result === first);
    console.log("Promise.resolve, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 6, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 6, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 6, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 6, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, form 6, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, form 6, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, form 6, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, form 6, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, form 6, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, form 6, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, form 6: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve.call(Promise, first);
    console.log("Promise.resolve, form 6, by call, is it an operand:", result === first);
    console.log("Promise.resolve, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 6, by call, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 6, by call, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 6, by call, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 6, by call, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, form 6, by call, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, form 6, by call, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, form 6, by call, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, form 6, by call, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by call, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by call, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by call, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, form 6, by call, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, form 6, by call, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, form 6, by call: it threw", error instanceof Error);
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
    const first = new Promise(resolve => resolve(item));
    const result = Promise.resolve.apply(Promise, [first]);
    console.log("Promise.resolve, form 6, by apply, is it an operand:", result === first);
    console.log("Promise.resolve, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 6, by apply, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 6, by apply, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 6, by apply, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, form 6, by apply, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, form 6, by apply, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, form 6, by apply, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, form 6, by apply, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by apply, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by apply, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by apply, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, form 6, by apply, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, form 6, by apply, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, form 6, by apply: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
