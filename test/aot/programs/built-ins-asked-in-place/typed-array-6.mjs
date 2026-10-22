// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.reverse();
    console.log("%TypedArray%.prototype.reverse, form 6, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.reverse, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.reverse, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.reverse, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.reverse, form 6, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.reverse, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.reverse, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.reverse, form 6, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.reverse, form 6, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.reverse, form 6, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.reverse, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.reverse, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.reverse, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.reverse.call(subject);
    console.log("%TypedArray%.prototype.reverse, form 6, by call, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.reverse, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by call, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.reverse, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.reverse, form 6, by call, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.reverse, form 6, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.reverse, form 6, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.reverse, form 6, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.reverse, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.reverse.apply(subject, []);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.reverse, form 6, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.reverse, form 6, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.reverse, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = Reflect.apply(subject.reverse, subject, []);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.reverse, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.reverse.bind(subject)();
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.reverse, form 6, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.reverse, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const first = new Uint8Array([1, 2, 3]);
    const result = subject.set(first, 0);
    console.log("%TypedArray%.prototype.set, is it an operand:", result === subject, result === first);
    console.log("%TypedArray%.prototype.set:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.set: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const first = new Uint8Array(0);
    const result = subject.set(first, 0);
    console.log("%TypedArray%.prototype.set, form 2, is it an operand:", result === subject, result === first);
    console.log("%TypedArray%.prototype.set, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.set, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.set(1.5, 2);
    console.log("%TypedArray%.prototype.set, form 3, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.set, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.set, form 3: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set(first, 2);
    console.log("%TypedArray%.prototype.set, form 4, is it an operand:", result === subject, result === first);
    console.log("%TypedArray%.prototype.set, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.set, form 4: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.set(item, 2);
    console.log("%TypedArray%.prototype.set, form 5, is it an operand:", result === subject, result === item);
    console.log("%TypedArray%.prototype.set, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.set, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.set(1.5, 0);
    console.log("%TypedArray%.prototype.set, form 6, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.set, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.set, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.slice(1, 2);
    console.log("%TypedArray%.prototype.slice, is it an operand:", result === subject);
    const again = subject.slice(1, 2);
    console.log("%TypedArray%.prototype.slice, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.slice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.slice, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.slice, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.slice, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.slice, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.slice, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.slice, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.slice, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.slice, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.slice, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.slice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.slice(1, 2);
    console.log("%TypedArray%.prototype.slice, form 2, is it an operand:", result === subject);
    const again = subject.slice(1, 2);
    console.log("%TypedArray%.prototype.slice, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.slice, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.slice, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.slice, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.slice, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.slice, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.slice, form 2, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.slice, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.slice, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.slice, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.slice, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.slice(1, 2);
    console.log("%TypedArray%.prototype.slice, form 3, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.slice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.slice, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.slice, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.slice, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.slice, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.slice, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.slice, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.slice, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.slice, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.slice, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.slice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.slice(1, 2);
    console.log("%TypedArray%.prototype.slice, form 4, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.slice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.slice, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.slice, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.slice, form 4, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.slice, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.slice, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.slice, form 4, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.slice, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.slice, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.slice, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.slice, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.slice, form 4: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.some(callback, second);
    console.log("%TypedArray%.prototype.some, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.some:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.some, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.some: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.some(callback, 2.5);
    console.log("%TypedArray%.prototype.some, form 2, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.some, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.some, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.some, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.some(callback, item);
    console.log("%TypedArray%.prototype.some, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("%TypedArray%.prototype.some, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.some, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.some, form 3: it threw", error instanceof Error);
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
    const subject = new Uint8Array(0);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.some(callback, second);
    console.log("%TypedArray%.prototype.some, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.some, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.some, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.some, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.sort();
    console.log("%TypedArray%.prototype.sort, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.sort.call(subject);
    console.log("%TypedArray%.prototype.sort, by call, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, by call, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.sort.apply(subject, []);
    console.log("%TypedArray%.prototype.sort, by apply, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, by apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = Reflect.apply(subject.sort, subject, []);
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.sort.bind(subject)();
    console.log("%TypedArray%.prototype.sort, by a bound function, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, by a bound function, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.sort();
    console.log("%TypedArray%.prototype.sort, form 6, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 6, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 6, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 6, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 6, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.sort.call(subject);
    console.log("%TypedArray%.prototype.sort, form 6, by call, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 6, by call, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 6, by call, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 6, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 6, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 6, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 6, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.sort.apply(subject, []);
    console.log("%TypedArray%.prototype.sort, form 6, by apply, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 6, by apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 6, by apply, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 6, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 6, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 6, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 6, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = Reflect.apply(subject.sort, subject, []);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.sort.bind(subject)();
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 6, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 6, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.sort(callback);
    console.log("%TypedArray%.prototype.sort, form 11, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 11, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 11, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, form 11, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 11, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 11, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 11: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
