// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".match(first);
    console.log("String.prototype.match, is it an operand:", result === first);
    const again = "banana".match(first);
    console.log("String.prototype.match, does a second call answer the same thing:", result === again);
    console.log("String.prototype.match:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.match, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.match, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.match, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.match, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.match, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("String.prototype.match, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("String.prototype.match, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.match, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.match: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "".match(first);
    console.log("String.prototype.match, form 2, is it an operand:", result === first);
    const again = "".match(first);
    console.log("String.prototype.match, form 2, does a second call answer the same thing:", result === again);
    console.log("String.prototype.match, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.match, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".match(1.5);
    console.log("String.prototype.match, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.match, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".match("an");
    console.log("String.prototype.match, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.match, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.match, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.match, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.match, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.match, form 4, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 4, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 4, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 4, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("String.prototype.match, form 4.index:", typeof result.index === "undefined", typeof result.index === "boolean", typeof result.index === "number", typeof result.index === "string", typeof result.index === "bigint", typeof result.index === "symbol", typeof result.index === "function", typeof result.index === "object", result.index === null);
    console.log("String.prototype.match, form 4.index, the number:", Number.isInteger(result.index), result.index === result.index, result.index < 0, result.index > 2147483647, result.index < -2147483648, Object.is(result.index, -0), (result.index | 0) === result.index);
    console.log("String.prototype.match, form 4.input:", typeof result.input === "undefined", typeof result.input === "boolean", typeof result.input === "number", typeof result.input === "string", typeof result.input === "bigint", typeof result.input === "symbol", typeof result.input === "function", typeof result.input === "object", result.input === null);
    console.log("String.prototype.match, form 4.input, the text:", result.input.length === 0, result.input === "");
    console.log("String.prototype.match, form 4.groups:", typeof result.groups === "undefined", typeof result.groups === "boolean", typeof result.groups === "number", typeof result.groups === "string", typeof result.groups === "bigint", typeof result.groups === "symbol", typeof result.groups === "function", typeof result.groups === "object", result.groups === null);
    console.log("String.prototype.match, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("String.prototype.match, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.match, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.match, form 4: it threw", error instanceof Error);
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
    const result = "banana".match(item);
    console.log("String.prototype.match, form 5, is it an operand:", result === item);
    console.log("String.prototype.match, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.match, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.match, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.match, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.match, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.match, form 5, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 5, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 5, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 5, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("String.prototype.match, form 5.index:", typeof result.index === "undefined", typeof result.index === "boolean", typeof result.index === "number", typeof result.index === "string", typeof result.index === "bigint", typeof result.index === "symbol", typeof result.index === "function", typeof result.index === "object", result.index === null);
    console.log("String.prototype.match, form 5.index, the number:", Number.isInteger(result.index), result.index === result.index, result.index < 0, result.index > 2147483647, result.index < -2147483648, Object.is(result.index, -0), (result.index | 0) === result.index);
    console.log("String.prototype.match, form 5.input:", typeof result.input === "undefined", typeof result.input === "boolean", typeof result.input === "number", typeof result.input === "string", typeof result.input === "bigint", typeof result.input === "symbol", typeof result.input === "function", typeof result.input === "object", result.input === null);
    console.log("String.prototype.match, form 5.input, the text:", result.input.length === 0, result.input === "");
    console.log("String.prototype.match, form 5.groups:", typeof result.groups === "undefined", typeof result.groups === "boolean", typeof result.groups === "number", typeof result.groups === "string", typeof result.groups === "bigint", typeof result.groups === "symbol", typeof result.groups === "function", typeof result.groups === "object", result.groups === null);
    console.log("String.prototype.match, form 5, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("String.prototype.match, form 5, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.match, form 5, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.match, form 5, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.match, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".match(1.5);
    console.log("String.prototype.match, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.match, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".matchAll(first);
    console.log("String.prototype.matchAll, is it an operand:", result === first);
    const again = "banana".matchAll(first);
    console.log("String.prototype.matchAll, does a second call answer the same thing:", result === again);
    console.log("String.prototype.matchAll:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.matchAll, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.matchAll, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.matchAll, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.matchAll, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.matchAll, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.matchAll, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.matchAll, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.matchAll: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "".matchAll(first);
    console.log("String.prototype.matchAll, form 2, is it an operand:", result === first);
    const again = "".matchAll(first);
    console.log("String.prototype.matchAll, form 2, does a second call answer the same thing:", result === again);
    console.log("String.prototype.matchAll, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.matchAll, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.matchAll, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.matchAll, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.matchAll, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.matchAll, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.matchAll, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.matchAll, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.matchAll, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".matchAll(1.5);
    console.log("String.prototype.matchAll, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.matchAll, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.matchAll, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.matchAll, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.matchAll, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.matchAll, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.matchAll, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.matchAll, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.matchAll, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".matchAll("an");
    console.log("String.prototype.matchAll, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.matchAll, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.matchAll, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.matchAll, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.matchAll, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.matchAll, form 4, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.matchAll, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.matchAll, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.matchAll, form 4: it threw", error instanceof Error);
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
    const result = "banana".matchAll(item);
    console.log("String.prototype.matchAll, form 5, is it an operand:", result === item);
    console.log("String.prototype.matchAll, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.matchAll, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.matchAll, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.matchAll, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.matchAll, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.matchAll, form 5, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.matchAll, form 5, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.matchAll, form 5, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.matchAll, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".matchAll(1.5);
    console.log("String.prototype.matchAll, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.matchAll, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("String.prototype.matchAll, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("String.prototype.matchAll, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("String.prototype.matchAll, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("String.prototype.matchAll, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("String.prototype.matchAll, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("String.prototype.matchAll, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("String.prototype.matchAll, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".normalize("NFC");
    console.log("String.prototype.normalize:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.normalize, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.normalize: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".normalize("NFC");
    console.log("String.prototype.normalize, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.normalize, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.normalize, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".padEnd(8, "-");
    console.log("String.prototype.padEnd:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padEnd, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padEnd: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".padEnd(8, "-");
    console.log("String.prototype.padEnd, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padEnd, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padEnd, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".padEnd(8, 2.5);
    console.log("String.prototype.padEnd, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padEnd, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padEnd, form 3: it threw", error instanceof Error);
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
    const result = "banana".padEnd(8, item);
    console.log("String.prototype.padEnd, form 4, is it an operand:", result === item);
    console.log("String.prototype.padEnd, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padEnd, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padEnd, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".padEnd(8, 2.5);
    console.log("String.prototype.padEnd, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padEnd, form 5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padEnd, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".padStart(8, "-");
    console.log("String.prototype.padStart:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padStart, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padStart: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".padStart(8, "-");
    console.log("String.prototype.padStart, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padStart, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padStart, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".padStart(8, 2.5);
    console.log("String.prototype.padStart, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padStart, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padStart, form 3: it threw", error instanceof Error);
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
    const result = "banana".padStart(8, item);
    console.log("String.prototype.padStart, form 4, is it an operand:", result === item);
    console.log("String.prototype.padStart, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padStart, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padStart, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".padStart(8, 2.5);
    console.log("String.prototype.padStart, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.padStart, form 5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.padStart, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".repeat(1);
    console.log("String.prototype.repeat:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.repeat, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.repeat: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".repeat(1);
    console.log("String.prototype.repeat, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.repeat, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.repeat, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".replace(first, 2.5);
    console.log("String.prototype.replace, is it an operand:", result === first);
    console.log("String.prototype.replace:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".replace(first, "-");
    console.log("String.prototype.replace, form 2, is it an operand:", result === first);
    console.log("String.prototype.replace, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 2: it threw", error instanceof Error);
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
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".replace(first, item);
    console.log("String.prototype.replace, form 3, is it an operand:", result === first, result === item);
    console.log("String.prototype.replace, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "".replace(first, 2.5);
    console.log("String.prototype.replace, form 4, is it an operand:", result === first);
    console.log("String.prototype.replace, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 4: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
