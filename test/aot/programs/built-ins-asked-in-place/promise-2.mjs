// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
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
    console.log("Promise.resolve, form 6, by Reflect.apply, is it an operand:", result === first);
    console.log("Promise.resolve, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 6, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 6, by Reflect.apply, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 6, by Reflect.apply, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, form 6, by Reflect.apply, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, form 6, by Reflect.apply, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, form 6, by Reflect.apply, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, form 6, by Reflect.apply, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by Reflect.apply, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by Reflect.apply, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by Reflect.apply, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, form 6, by Reflect.apply, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, form 6, by Reflect.apply, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    console.log("Promise.resolve, form 6, by a bound function, is it an operand:", result === first);
    console.log("Promise.resolve, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 6, by a bound function, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 6, by a bound function, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 6, by a bound function, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, form 6, by a bound function, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, form 6, by a bound function, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, form 6, by a bound function, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, form 6, by a bound function, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by a bound function, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by a bound function, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 6, by a bound function, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, form 6, by a bound function, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, form 6, by a bound function, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.resolve(null);
    const again = Promise.resolve(null);
    console.log("Promise.resolve, form 11, does a second call answer the same thing:", result === again);
    console.log("Promise.resolve, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 11, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 11, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 11, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
    }
  } catch (error) {
    console.log("Promise.resolve, form 11: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.resolve(1.5);
    const again = Promise.resolve(1.5);
    console.log("Promise.resolve, form 12, does a second call answer the same thing:", result === again);
    console.log("Promise.resolve, form 12:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 12, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 12, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 12, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 12, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 12, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 12, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 12, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 12, settled, the number:", Number.isInteger(settled), settled === settled, settled < 0, settled > 2147483647, settled < -2147483648, Object.is(settled, -0), (settled | 0) === settled);
    }
  } catch (error) {
    console.log("Promise.resolve, form 12: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.resolve("an");
    const again = Promise.resolve("an");
    console.log("Promise.resolve, form 13, does a second call answer the same thing:", result === again);
    console.log("Promise.resolve, form 13:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 13, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 13, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 13, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 13, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 13, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 13, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 13, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 13, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Promise.resolve, form 13: it threw", error instanceof Error);
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
    const result = Promise.resolve(item);
    console.log("Promise.resolve, form 14, is it an operand:", result === item);
    const again = Promise.resolve(item);
    console.log("Promise.resolve, form 14, does a second call answer the same thing:", result === again);
    console.log("Promise.resolve, form 14:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.resolve, form 14, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.resolve, form 14, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.resolve, form 14, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.resolve, form 14, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.resolve, form 14, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.resolve, form 14, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.resolve, form 14, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.resolve, form 14, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.resolve, form 14, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.resolve, form 14, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.resolve, form 14, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.resolve, form 14, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 14, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 14, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.resolve, form 14, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.resolve, form 14, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.resolve, form 14, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.resolve, form 14: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.try(1.5, 2.5, "-");
    console.log("Promise.try:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.try, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.try, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.try, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.try, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.try, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.try, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.try: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.try("an", 2.5, "-");
    console.log("Promise.try, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.try, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.try, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.try, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.try, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.try, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.try, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.try, form 2: it threw", error instanceof Error);
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
    const result = Promise.try(item, item, 2.5);
    console.log("Promise.try, form 3, is it an operand:", result === item, result === item);
    console.log("Promise.try, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.try, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.try, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.try, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.try, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.try, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.try, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.try, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.try(1.5, 2.5, "-");
    console.log("Promise.try, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.try, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.try, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.try, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.try, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.try, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.try, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise.try, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.withResolvers();
    const again = Promise.withResolvers();
    console.log("Promise.withResolvers, does a second call answer the same thing:", result === again);
    console.log("Promise.withResolvers:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.withResolvers, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.withResolvers, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.withResolvers, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.withResolvers, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.withResolvers, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Promise.withResolvers, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Promise.withResolvers, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Promise.withResolvers, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Promise.withResolvers.resolve:", typeof result.resolve === "undefined", typeof result.resolve === "boolean", typeof result.resolve === "number", typeof result.resolve === "string", typeof result.resolve === "bigint", typeof result.resolve === "symbol", typeof result.resolve === "function", typeof result.resolve === "object", result.resolve === null);
    console.log("Promise.withResolvers.resolve, the class:", Array.isArray(result.resolve), result.resolve instanceof Object, result.resolve instanceof Array, result.resolve instanceof Map, result.resolve instanceof Set, result.resolve instanceof Promise, result.resolve instanceof Date, result.resolve instanceof RegExp, result.resolve instanceof Error, result.resolve instanceof ArrayBuffer, result.resolve instanceof Uint8Array, result.resolve instanceof Function, ArrayBuffer.isView(result.resolve));
    console.log("Promise.withResolvers.resolve, above it:", Object.getPrototypeOf(result.resolve) === Object.prototype, Object.getPrototypeOf(result.resolve) === Array.prototype, Object.getPrototypeOf(result.resolve) === null);
    console.log("Promise.withResolvers.resolve, its state:", Object.isFrozen(result.resolve), Object.isSealed(result.resolve), Object.isExtensible(result.resolve));
    console.log("Promise.withResolvers.resolve, names in it:", "length" in result.resolve, "size" in result.resolve, "then" in result.resolve, "next" in result.resolve, "constructor" in result.resolve, Symbol.iterator in result.resolve);
    console.log("Promise.withResolvers.resolve, how many keys:", Object.keys(result.resolve).length);
    console.log("Promise.withResolvers.reject:", typeof result.reject === "undefined", typeof result.reject === "boolean", typeof result.reject === "number", typeof result.reject === "string", typeof result.reject === "bigint", typeof result.reject === "symbol", typeof result.reject === "function", typeof result.reject === "object", result.reject === null);
    console.log("Promise.withResolvers.reject, the class:", Array.isArray(result.reject), result.reject instanceof Object, result.reject instanceof Array, result.reject instanceof Map, result.reject instanceof Set, result.reject instanceof Promise, result.reject instanceof Date, result.reject instanceof RegExp, result.reject instanceof Error, result.reject instanceof ArrayBuffer, result.reject instanceof Uint8Array, result.reject instanceof Function, ArrayBuffer.isView(result.reject));
    console.log("Promise.withResolvers.reject, above it:", Object.getPrototypeOf(result.reject) === Object.prototype, Object.getPrototypeOf(result.reject) === Array.prototype, Object.getPrototypeOf(result.reject) === null);
    console.log("Promise.withResolvers.reject, its state:", Object.isFrozen(result.reject), Object.isSealed(result.reject), Object.isExtensible(result.reject));
    console.log("Promise.withResolvers.reject, names in it:", "length" in result.reject, "size" in result.reject, "then" in result.reject, "next" in result.reject, "constructor" in result.reject, Symbol.iterator in result.reject);
    console.log("Promise.withResolvers.reject, how many keys:", Object.keys(result.reject).length);
    console.log("Promise.withResolvers.promise:", typeof result.promise === "undefined", typeof result.promise === "boolean", typeof result.promise === "number", typeof result.promise === "string", typeof result.promise === "bigint", typeof result.promise === "symbol", typeof result.promise === "function", typeof result.promise === "object", result.promise === null);
    console.log("Promise.withResolvers.promise, the class:", Array.isArray(result.promise), result.promise instanceof Object, result.promise instanceof Array, result.promise instanceof Map, result.promise instanceof Set, result.promise instanceof Promise, result.promise instanceof Date, result.promise instanceof RegExp, result.promise instanceof Error, result.promise instanceof ArrayBuffer, result.promise instanceof Uint8Array, result.promise instanceof Function, ArrayBuffer.isView(result.promise));
    console.log("Promise.withResolvers.promise, above it:", Object.getPrototypeOf(result.promise) === Object.prototype, Object.getPrototypeOf(result.promise) === Array.prototype, Object.getPrototypeOf(result.promise) === null);
    console.log("Promise.withResolvers.promise, its own class:", Object.getPrototypeOf(result.promise) === Promise.prototype, Reflect.getPrototypeOf(result.promise) === Promise.prototype, result.promise.constructor === Promise, Object.getPrototypeOf(result.promise) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.withResolvers.promise, its state:", Object.isFrozen(result.promise), Object.isSealed(result.promise), Object.isExtensible(result.promise));
    console.log("Promise.withResolvers.promise, names in it:", "length" in result.promise, "size" in result.promise, "then" in result.promise, "next" in result.promise, "constructor" in result.promise, Symbol.iterator in result.promise);
    console.log("Promise.withResolvers.promise, how many keys:", Object.keys(result.promise).length);
  } catch (error) {
    console.log("Promise.withResolvers: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise.withResolvers();
    const again = Promise.withResolvers();
    console.log("Promise.withResolvers, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.withResolvers, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.withResolvers, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.withResolvers, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.withResolvers, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.withResolvers, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.withResolvers, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Promise.withResolvers, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Promise.withResolvers, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Promise.withResolvers, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Promise.withResolvers, form 2.resolve:", typeof result.resolve === "undefined", typeof result.resolve === "boolean", typeof result.resolve === "number", typeof result.resolve === "string", typeof result.resolve === "bigint", typeof result.resolve === "symbol", typeof result.resolve === "function", typeof result.resolve === "object", result.resolve === null);
    console.log("Promise.withResolvers, form 2.resolve, the class:", Array.isArray(result.resolve), result.resolve instanceof Object, result.resolve instanceof Array, result.resolve instanceof Map, result.resolve instanceof Set, result.resolve instanceof Promise, result.resolve instanceof Date, result.resolve instanceof RegExp, result.resolve instanceof Error, result.resolve instanceof ArrayBuffer, result.resolve instanceof Uint8Array, result.resolve instanceof Function, ArrayBuffer.isView(result.resolve));
    console.log("Promise.withResolvers, form 2.resolve, above it:", Object.getPrototypeOf(result.resolve) === Object.prototype, Object.getPrototypeOf(result.resolve) === Array.prototype, Object.getPrototypeOf(result.resolve) === null);
    console.log("Promise.withResolvers, form 2.resolve, its state:", Object.isFrozen(result.resolve), Object.isSealed(result.resolve), Object.isExtensible(result.resolve));
    console.log("Promise.withResolvers, form 2.resolve, names in it:", "length" in result.resolve, "size" in result.resolve, "then" in result.resolve, "next" in result.resolve, "constructor" in result.resolve, Symbol.iterator in result.resolve);
    console.log("Promise.withResolvers, form 2.resolve, how many keys:", Object.keys(result.resolve).length);
    console.log("Promise.withResolvers, form 2.reject:", typeof result.reject === "undefined", typeof result.reject === "boolean", typeof result.reject === "number", typeof result.reject === "string", typeof result.reject === "bigint", typeof result.reject === "symbol", typeof result.reject === "function", typeof result.reject === "object", result.reject === null);
    console.log("Promise.withResolvers, form 2.reject, the class:", Array.isArray(result.reject), result.reject instanceof Object, result.reject instanceof Array, result.reject instanceof Map, result.reject instanceof Set, result.reject instanceof Promise, result.reject instanceof Date, result.reject instanceof RegExp, result.reject instanceof Error, result.reject instanceof ArrayBuffer, result.reject instanceof Uint8Array, result.reject instanceof Function, ArrayBuffer.isView(result.reject));
    console.log("Promise.withResolvers, form 2.reject, above it:", Object.getPrototypeOf(result.reject) === Object.prototype, Object.getPrototypeOf(result.reject) === Array.prototype, Object.getPrototypeOf(result.reject) === null);
    console.log("Promise.withResolvers, form 2.reject, its state:", Object.isFrozen(result.reject), Object.isSealed(result.reject), Object.isExtensible(result.reject));
    console.log("Promise.withResolvers, form 2.reject, names in it:", "length" in result.reject, "size" in result.reject, "then" in result.reject, "next" in result.reject, "constructor" in result.reject, Symbol.iterator in result.reject);
    console.log("Promise.withResolvers, form 2.reject, how many keys:", Object.keys(result.reject).length);
    console.log("Promise.withResolvers, form 2.promise:", typeof result.promise === "undefined", typeof result.promise === "boolean", typeof result.promise === "number", typeof result.promise === "string", typeof result.promise === "bigint", typeof result.promise === "symbol", typeof result.promise === "function", typeof result.promise === "object", result.promise === null);
    console.log("Promise.withResolvers, form 2.promise, the class:", Array.isArray(result.promise), result.promise instanceof Object, result.promise instanceof Array, result.promise instanceof Map, result.promise instanceof Set, result.promise instanceof Promise, result.promise instanceof Date, result.promise instanceof RegExp, result.promise instanceof Error, result.promise instanceof ArrayBuffer, result.promise instanceof Uint8Array, result.promise instanceof Function, ArrayBuffer.isView(result.promise));
    console.log("Promise.withResolvers, form 2.promise, above it:", Object.getPrototypeOf(result.promise) === Object.prototype, Object.getPrototypeOf(result.promise) === Array.prototype, Object.getPrototypeOf(result.promise) === null);
    console.log("Promise.withResolvers, form 2.promise, its own class:", Object.getPrototypeOf(result.promise) === Promise.prototype, Reflect.getPrototypeOf(result.promise) === Promise.prototype, result.promise.constructor === Promise, Object.getPrototypeOf(result.promise) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.withResolvers, form 2.promise, its state:", Object.isFrozen(result.promise), Object.isSealed(result.promise), Object.isExtensible(result.promise));
    console.log("Promise.withResolvers, form 2.promise, names in it:", "length" in result.promise, "size" in result.promise, "then" in result.promise, "next" in result.promise, "constructor" in result.promise, Symbol.iterator in result.promise);
    console.log("Promise.withResolvers, form 2.promise, how many keys:", Object.keys(result.promise).length);
  } catch (error) {
    console.log("Promise.withResolvers, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Promise[Symbol.species];
    console.log("Promise[Symbol.species], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise[Symbol.species], get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise[Symbol.species], get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise[Symbol.species], get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise[Symbol.species], get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise[Symbol.species], get: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    function callback() {
      return true;
    }
    const result = promise.catch(callback);
    console.log("Promise.prototype.catch, is it an operand:", result === promise, result === callback);
    const again = promise.catch(callback);
    console.log("Promise.prototype.catch, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.catch:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.catch(1.5);
    console.log("Promise.prototype.catch, form 2, is it an operand:", result === promise);
    const again = promise.catch(1.5);
    console.log("Promise.prototype.catch, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.catch, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, form 2, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, form 2, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch, form 2: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.catch("an");
    console.log("Promise.prototype.catch, form 3, is it an operand:", result === promise);
    const again = promise.catch("an");
    console.log("Promise.prototype.catch, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.catch, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, form 3, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, form 3, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, form 3, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, form 3, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, form 3, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, form 3, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, form 3, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 3, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 3, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 3, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, form 3, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, form 3, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch, form 3: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.catch(item);
    console.log("Promise.prototype.catch, form 4, is it an operand:", result === promise, result === item);
    const again = promise.catch(item);
    console.log("Promise.prototype.catch, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.catch, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, form 4, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, form 4, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, form 4, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, form 4, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, form 4, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, form 4, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, form 4, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 4, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 4, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 4, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, form 4, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, form 4, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch, form 4: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.catch(1.5);
    console.log("Promise.prototype.catch, form 5, is it an operand:", result === promise);
    console.log("Promise.prototype.catch, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, form 5, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, form 5, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, form 5, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, form 5, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, form 5, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, form 5, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, form 5, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, form 5, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 5, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 5, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 5, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, form 5, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, form 5, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch, form 5: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.catch("an");
    console.log("Promise.prototype.catch, form 6, is it an operand:", result === promise);
    console.log("Promise.prototype.catch, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, form 6, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, form 6, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, form 6, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, form 6, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, form 6, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, form 6, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, form 6, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, form 6, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 6, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 6, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 6, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, form 6, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, form 6, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch, form 6: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.catch(item);
    console.log("Promise.prototype.catch, form 7, is it an operand:", result === promise, result === item);
    console.log("Promise.prototype.catch, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.catch, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.catch, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.catch, form 7, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.catch, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.catch, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.catch, form 7, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.catch, form 7, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.catch, form 7, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.catch, form 7, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.catch, form 7, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.catch, form 7, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.catch, form 7, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 7, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 7, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.catch, form 7, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.catch, form 7, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.catch, form 7, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.catch, form 7: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.finally(1.5);
    console.log("Promise.prototype.finally, is it an operand:", result === promise);
    const again = promise.finally(1.5);
    console.log("Promise.prototype.finally, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.finally:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.finally, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.finally, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.finally, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.finally, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.finally, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.finally, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.finally, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.finally, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.finally, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.finally, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.finally, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.finally, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.finally, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.finally, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.finally: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.finally("an");
    console.log("Promise.prototype.finally, form 2, is it an operand:", result === promise);
    const again = promise.finally("an");
    console.log("Promise.prototype.finally, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.finally, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.finally, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.finally, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.finally, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.finally, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.finally, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.finally, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.finally, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.finally, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.finally, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.finally, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.finally, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.finally, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.finally, form 2, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.finally, form 2, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.finally, form 2: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.finally(item);
    console.log("Promise.prototype.finally, form 3, is it an operand:", result === promise, result === item);
    const again = promise.finally(item);
    console.log("Promise.prototype.finally, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.finally, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.finally, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.finally, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.finally, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.finally, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.finally, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.finally, form 3, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.finally, form 3, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.finally, form 3, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.finally, form 3, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.finally, form 3, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.finally, form 3, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.finally, form 3, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 3, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 3, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 3, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.finally, form 3, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.finally, form 3, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.finally, form 3: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.finally(1.5);
    console.log("Promise.prototype.finally, form 4, is it an operand:", result === promise);
    console.log("Promise.prototype.finally, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.finally, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.finally, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.finally, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.finally, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.finally, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.finally, form 4, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.finally, form 4, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.finally, form 4, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.finally, form 4, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.finally, form 4, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.finally, form 4, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.finally, form 4, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 4, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 4, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 4, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.finally, form 4, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.finally, form 4, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.finally, form 4: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.finally("an");
    console.log("Promise.prototype.finally, form 5, is it an operand:", result === promise);
    console.log("Promise.prototype.finally, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.finally, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.finally, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.finally, form 5, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.finally, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.finally, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.finally, form 5, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.finally, form 5, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.finally, form 5, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.finally, form 5, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.finally, form 5, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.finally, form 5, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.finally, form 5, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 5, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 5, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 5, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.finally, form 5, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.finally, form 5, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.finally, form 5: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const result = promise.finally(item);
    console.log("Promise.prototype.finally, form 6, is it an operand:", result === promise, result === item);
    console.log("Promise.prototype.finally, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.finally, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.finally, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.finally, form 6, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.finally, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.finally, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.finally, form 6, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.finally, form 6, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.finally, form 6, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Promise.prototype.finally, form 6, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Promise.prototype.finally, form 6, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Promise.prototype.finally, form 6, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Promise.prototype.finally, form 6, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 6, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 6, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Promise.prototype.finally, form 6, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Promise.prototype.finally, form 6, settled.size:", typeof settled.size === "undefined", typeof settled.size === "boolean", typeof settled.size === "number", typeof settled.size === "string", typeof settled.size === "bigint", typeof settled.size === "symbol", typeof settled.size === "function", typeof settled.size === "object", settled.size === null);
      console.log("Promise.prototype.finally, form 6, settled.size, the number:", Number.isInteger(settled.size), settled.size === settled.size, settled.size < 0, settled.size > 2147483647, settled.size < -2147483648, Object.is(settled.size, -0), (settled.size | 0) === settled.size);
    }
  } catch (error) {
    console.log("Promise.prototype.finally, form 6: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    function callback() {
      return true;
    }
    function otherCallback() {
      return true;
    }
    const result = promise.then(callback, otherCallback);
    console.log("Promise.prototype.then, is it an operand:", result === promise, result === callback, result === otherCallback);
    const again = promise.then(callback, otherCallback);
    console.log("Promise.prototype.then, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.then:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.then, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.then, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.then, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.then, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.then, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.then, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.then, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.then, settled, the boolean:", settled === true, settled === false, !settled);
    }
  } catch (error) {
    console.log("Promise.prototype.then: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = promise.then(callback, second);
    console.log("Promise.prototype.then, form 2, is it an operand:", result === promise, result === callback, result === second);
    const again = promise.then(callback, second);
    console.log("Promise.prototype.then, form 2, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.then, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.then, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.then, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.then, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.then, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.then, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.then, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.then, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.then, form 2, settled, the boolean:", settled === true, settled === false, !settled);
    }
  } catch (error) {
    console.log("Promise.prototype.then, form 2: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    function callback() {
      return true;
    }
    const result = promise.then(callback, 2.5);
    console.log("Promise.prototype.then, form 3, is it an operand:", result === promise, result === callback);
    const again = promise.then(callback, 2.5);
    console.log("Promise.prototype.then, form 3, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.then, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.then, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.then, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.then, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.then, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.then, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.then, form 3, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.then, form 3, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.then, form 3, settled, the boolean:", settled === true, settled === false, !settled);
    }
  } catch (error) {
    console.log("Promise.prototype.then, form 3: it threw", error instanceof Error);
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
    const promise = new Promise(resolve => resolve(item));
    function callback() {
      return true;
    }
    const result = promise.then(callback, item);
    console.log("Promise.prototype.then, form 4, is it an operand:", result === promise, result === callback, result === item);
    const again = promise.then(callback, item);
    console.log("Promise.prototype.then, form 4, does a second call answer the same thing:", result === again);
    console.log("Promise.prototype.then, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise.prototype.then, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise.prototype.then, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise.prototype.then, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise.prototype.then, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise.prototype.then, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise.prototype.then, form 4, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Promise.prototype.then, form 4, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Promise.prototype.then, form 4, settled, the boolean:", settled === true, settled === false, !settled);
    }
  } catch (error) {
    console.log("Promise.prototype.then, form 4: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
