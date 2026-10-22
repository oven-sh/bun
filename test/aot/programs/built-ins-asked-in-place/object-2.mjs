// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Object.assign(Symbol.for("name"), "-", "-");
    const again = Object.assign(Symbol.for("name"), "-", "-");
    console.log("Object.assign, form 31, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 31:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 31, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 31, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 31, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 31, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 31, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 31, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 31, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 31, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 31: it threw", error instanceof Error);
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
    const result = Object.assign(Symbol.for("name"), item, 2.5);
    console.log("Object.assign, form 32, is it an operand:", result === item);
    const again = Object.assign(Symbol.for("name"), item, 2.5);
    console.log("Object.assign, form 32, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 32, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 32, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 32, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 32, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 32, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 32, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 32, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 32, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 32.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 32.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(5n, 2.5, "-");
    const again = Object.assign(5n, 2.5, "-");
    console.log("Object.assign, form 33, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 33:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 33, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 33, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 33, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 33, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 33, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 33, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 33, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 33, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 33: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(5n, "-", "-");
    const again = Object.assign(5n, "-", "-");
    console.log("Object.assign, form 34, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 34:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 34, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 34, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 34, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 34, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 34, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 34, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 34, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 34, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 34: it threw", error instanceof Error);
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
    const result = Object.assign(5n, item, 2.5);
    console.log("Object.assign, form 35, is it an operand:", result === item);
    const again = Object.assign(5n, item, 2.5);
    console.log("Object.assign, form 35, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 35:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 35, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 35, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 35, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 35, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 35, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 35, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 35, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 35, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 35.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 35.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 35: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.create(null);
    const again = Object.create(null);
    console.log("Object.create, does a second call answer the same thing:", result === again);
    console.log("Object.create:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.create, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.create, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.create, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.create, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.create, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.create: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Object.create(first);
    console.log("Object.create, form 2, is it an operand:", result === first);
    const again = Object.create(first);
    console.log("Object.create, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.create, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.create, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.create, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.create, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.create, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.create, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.create, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.create(null);
    const again = Object.create(null);
    console.log("Object.create, form 3, does a second call answer the same thing:", result === again);
    console.log("Object.create, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.create, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.create, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.create, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.create, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.create, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.create, form 3: it threw", error instanceof Error);
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
    const second = [["first", 1.5], ["second", item]];
    const result = Object.create(null, second);
    console.log("Object.create, form 4, is it an operand:", result === second);
    const again = Object.create(null, second);
    console.log("Object.create, form 4, does a second call answer the same thing:", result === again);
    console.log("Object.create, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.create, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.create, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.create, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.create, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.create, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.create, form 4: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.create(first, second);
    console.log("Object.create, form 5, is it an operand:", result === first, result === second);
    const again = Object.create(first, second);
    console.log("Object.create, form 5, does a second call answer the same thing:", result === again);
    console.log("Object.create, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.create, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.create, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.create, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.create, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.create, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.create, form 5: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties(first, second);
    console.log("Object.defineProperties, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.call(Object, first, second);
    console.log("Object.defineProperties, by call, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, by call: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.apply(Object, [first, second]);
    console.log("Object.defineProperties, by apply, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, by apply: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Reflect.apply(Object.defineProperties, Object, [first, second]);
    console.log("Object.defineProperties, by Reflect.apply, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, by Reflect.apply: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.bind(Object)(first, second);
    console.log("Object.defineProperties, by a bound function, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, by a bound function: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties(first, second);
    console.log("Object.defineProperties, form 6, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 6, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.defineProperties, form 6, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.defineProperties, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.defineProperties, form 6: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.call(Object, first, second);
    console.log("Object.defineProperties, form 6, by call, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 6, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.defineProperties, form 6, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.defineProperties, form 6, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.defineProperties, form 6, by call: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.apply(Object, [first, second]);
    console.log("Object.defineProperties, form 6, by apply, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 6, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.defineProperties, form 6, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.defineProperties, form 6, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.defineProperties, form 6, by apply: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const second = [["first", 1.5], ["second", item]];
    const result = Reflect.apply(Object.defineProperties, Object, [first, second]);
    console.log("Object.defineProperties, form 6, by Reflect.apply, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 6, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.defineProperties, form 6, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.defineProperties, form 6, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.defineProperties, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.bind(Object)(first, second);
    console.log("Object.defineProperties, form 6, by a bound function, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 6, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.defineProperties, form 6, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 6, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.defineProperties, form 6, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.defineProperties, form 6, by a bound function: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties(first, second);
    console.log("Object.defineProperties, form 11, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 11, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, form 11.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, form 11.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, form 11.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, form 11.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, form 11.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, form 11.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, form 11.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, form 11.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, form 11.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, form 11.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, form 11: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.call(Object, first, second);
    console.log("Object.defineProperties, form 11, by call, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 11, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, form 11, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, form 11, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, form 11, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, form 11, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, form 11, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, form 11, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, form 11, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, form 11, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, form 11, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, form 11, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, form 11, by call: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.apply(Object, [first, second]);
    console.log("Object.defineProperties, form 11, by apply, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 11, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, form 11, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, form 11, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, form 11, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, form 11, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, form 11, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, form 11, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, form 11, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, form 11, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, form 11, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, form 11, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, form 11, by apply: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Reflect.apply(Object.defineProperties, Object, [first, second]);
    console.log("Object.defineProperties, form 11, by Reflect.apply, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, form 11, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, form 11, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, form 11, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, form 11, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, form 11, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, form 11, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const second = [["first", 1.5], ["second", item]];
    const result = Object.defineProperties.bind(Object)(first, second);
    console.log("Object.defineProperties, form 11, by a bound function, is it an operand:", result === first, result === second);
    console.log("Object.defineProperties, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperties, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperties, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperties, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperties, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperties, form 11, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperties, form 11, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperties, form 11, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperties, form 11, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperties, form 11, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperties, form 11, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperties, form 11, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperties, form 11, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperties, form 11, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperties, form 11, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperties, form 11, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperties, form 11, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperties, form 11, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperties, form 11, by a bound function: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Object.defineProperty(first, "-", third);
    console.log("Object.defineProperty, is it an operand:", result === first, result === third);
    console.log("Object.defineProperty:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperty, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperty, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperty, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperty, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperty, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperty.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperty.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperty.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperty.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperty.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperty.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperty.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperty.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperty.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperty.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperty.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperty.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperty: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Object.defineProperty.call(Object, first, "-", third);
    console.log("Object.defineProperty, by call, is it an operand:", result === first, result === third);
    console.log("Object.defineProperty, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperty, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperty, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperty, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperty, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperty, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperty, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperty, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperty, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperty, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperty, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperty, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperty, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperty, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperty, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperty, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperty, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperty, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperty, by call: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Object.defineProperty.apply(Object, [first, "-", third]);
    console.log("Object.defineProperty, by apply, is it an operand:", result === first, result === third);
    console.log("Object.defineProperty, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperty, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperty, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperty, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperty, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperty, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperty, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperty, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperty, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperty, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperty, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperty, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperty, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperty, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperty, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperty, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperty, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperty, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperty, by apply: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(Object.defineProperty, Object, [first, "-", third]);
    console.log("Object.defineProperty, by Reflect.apply, is it an operand:", result === first, result === third);
    console.log("Object.defineProperty, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperty, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperty, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperty, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperty, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperty, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperty, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperty, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperty, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperty, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperty, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperty, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperty, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperty, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperty, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperty, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperty, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperty, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperty, by Reflect.apply: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Object.defineProperty.bind(Object)(first, "-", third);
    console.log("Object.defineProperty, by a bound function, is it an operand:", result === first, result === third);
    console.log("Object.defineProperty, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.defineProperty, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.defineProperty, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.defineProperty, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.defineProperty, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.defineProperty, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.defineProperty, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.defineProperty, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.defineProperty, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.defineProperty, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.defineProperty, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.defineProperty, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.defineProperty, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.defineProperty, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.defineProperty, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.defineProperty, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.defineProperty, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.defineProperty, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.defineProperty, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.defineProperty, by a bound function: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
