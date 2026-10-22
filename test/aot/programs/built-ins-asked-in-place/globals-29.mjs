// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2, 3.5, "x");
    console.log("setTimeout, form 4, is it an operand:", result === callback);
    const again = setTimeout(callback, 2, 3.5, "x");
    console.log("setTimeout, form 4, does a second call answer the same thing:", result === again);
    console.log("setTimeout, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2.5, 3.5, "x");
    console.log("setTimeout, form 5, is it an operand:", result === callback);
    const again = setTimeout(callback, 2.5, 3.5, "x");
    console.log("setTimeout, form 5, does a second call answer the same thing:", result === again);
    console.log("setTimeout, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2.5, "x", "x");
    console.log("setTimeout, form 6, is it an operand:", result === callback);
    const again = setTimeout(callback, 2.5, "x", "x");
    console.log("setTimeout, form 6, does a second call answer the same thing:", result === again);
    console.log("setTimeout, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout, form 6: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2.5, item, 3.5);
    console.log("setTimeout, form 7, is it an operand:", result === callback, result === item);
    const again = setTimeout(callback, 2.5, item, 3.5);
    console.log("setTimeout, form 7, does a second call answer the same thing:", result === again);
    console.log("setTimeout, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, form 7, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = structuredClone(null, null);
    console.log("structuredClone:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("structuredClone: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = structuredClone(null, null);
    console.log("structuredClone, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("structuredClone, form 2: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = structuredClone(1.5, second);
    console.log("structuredClone, form 3, is it an operand:", result === second);
    const again = structuredClone(1.5, second);
    console.log("structuredClone, form 3, does a second call answer the same thing:", result === again);
    console.log("structuredClone, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("structuredClone, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("structuredClone, form 3: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = structuredClone("an", second);
    console.log("structuredClone, form 4, is it an operand:", result === second);
    const again = structuredClone("an", second);
    console.log("structuredClone, form 4, does a second call answer the same thing:", result === again);
    console.log("structuredClone, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("structuredClone, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("structuredClone, form 4: it threw", error instanceof Error);
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
    const result = structuredClone(item, item);
    console.log("structuredClone, form 5, is it an operand:", result === item, result === item);
    const again = structuredClone(item, item);
    console.log("structuredClone, form 5, does a second call answer the same thing:", result === again);
    console.log("structuredClone, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("structuredClone, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("structuredClone, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("structuredClone, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("structuredClone, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("structuredClone, form 5, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("structuredClone, form 5, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("structuredClone, form 5, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("structuredClone, form 5, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("structuredClone, form 5.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("structuredClone, form 5.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("structuredClone, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = undefined;
    console.log("undefined, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("undefined, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = unescape("an");
    console.log("unescape:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("unescape, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("unescape: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = unescape("an");
    console.log("unescape, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("unescape, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("unescape, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
