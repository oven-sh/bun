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
    const set = new Set([1.5, item]);
    const first = new Set([1.5, item]);
    const result = set.difference(first);
    console.log("Set.prototype.difference, is it an operand:", result === set, result === first);
    const again = set.difference(first);
    console.log("Set.prototype.difference, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.difference:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.difference, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.difference, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.difference, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.difference, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.difference, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.difference, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.difference, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.difference, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.difference: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const first = new Set([item]);
    const result = set.difference(first);
    console.log("Set.prototype.difference, form 2, is it an operand:", result === set, result === first);
    const again = set.difference(first);
    console.log("Set.prototype.difference, form 2, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.difference, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.difference, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.difference, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.difference, form 2, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.difference, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.difference, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.difference, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.difference, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.difference, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.difference, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const first = new Set();
    const result = set.difference(first);
    console.log("Set.prototype.difference, form 3, is it an operand:", result === set, result === first);
    const again = set.difference(first);
    console.log("Set.prototype.difference, form 3, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.difference, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.difference, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.difference, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.difference, form 3, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.difference, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.difference, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.difference, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.difference, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.difference, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.difference, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const result = set.entries();
    console.log("Set.prototype.entries, is it an operand:", result === set);
    const again = set.entries();
    console.log("Set.prototype.entries, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.entries:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.entries, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.entries, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.entries, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.entries, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.entries, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.entries, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.entries, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.entries: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const result = set.entries();
    console.log("Set.prototype.entries, form 2, is it an operand:", result === set);
    const again = set.entries();
    console.log("Set.prototype.entries, form 2, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.entries, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.entries, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.entries, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.entries, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.entries, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.entries, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.entries, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.entries, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.entries, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const result = set.entries();
    console.log("Set.prototype.entries, form 3, is it an operand:", result === set);
    const again = set.entries();
    console.log("Set.prototype.entries, form 3, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.entries, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.entries, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.entries, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.entries, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.entries, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.entries, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.entries, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.entries, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.entries, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = set.forEach(callback, second);
    console.log("Set.prototype.forEach, is it an operand:", result === set, result === callback, result === second);
    console.log("Set.prototype.forEach:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Set.prototype.forEach: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    function callback() {
      return true;
    }
    const result = set.forEach(callback, 2.5);
    console.log("Set.prototype.forEach, form 2, is it an operand:", result === set, result === callback);
    console.log("Set.prototype.forEach, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Set.prototype.forEach, form 2: it threw", error instanceof Error);
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
    const set = new Set([item]);
    function callback() {
      return true;
    }
    const result = set.forEach(callback, item);
    console.log("Set.prototype.forEach, form 3, is it an operand:", result === set, result === callback, result === item);
    console.log("Set.prototype.forEach, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Set.prototype.forEach, form 3: it threw", error instanceof Error);
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
    const set = new Set();
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = set.forEach(callback, second);
    console.log("Set.prototype.forEach, form 4, is it an operand:", result === set, result === callback, result === second);
    console.log("Set.prototype.forEach, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Set.prototype.forEach, form 4: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const result = set.has(1.5);
    console.log("Set.prototype.has, is it an operand:", result === set);
    console.log("Set.prototype.has:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.has, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.has: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const result = set.has("an");
    console.log("Set.prototype.has, form 2, is it an operand:", result === set);
    console.log("Set.prototype.has, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.has, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.has, form 2: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const result = set.has(item);
    console.log("Set.prototype.has, form 3, is it an operand:", result === set, result === item);
    console.log("Set.prototype.has, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.has, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.has, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const result = set.has(1.5);
    console.log("Set.prototype.has, form 4, is it an operand:", result === set);
    console.log("Set.prototype.has, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.has, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.has, form 4: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const first = new Set([1.5, item]);
    const result = set.intersection(first);
    console.log("Set.prototype.intersection, is it an operand:", result === set, result === first);
    const again = set.intersection(first);
    console.log("Set.prototype.intersection, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.intersection:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.intersection, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.intersection, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.intersection, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.intersection, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.intersection, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.intersection, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.intersection, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.intersection, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.intersection: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const first = new Set([item]);
    const result = set.intersection(first);
    console.log("Set.prototype.intersection, form 2, is it an operand:", result === set, result === first);
    const again = set.intersection(first);
    console.log("Set.prototype.intersection, form 2, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.intersection, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.intersection, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.intersection, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.intersection, form 2, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.intersection, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.intersection, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.intersection, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.intersection, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.intersection, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.intersection, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const first = new Set();
    const result = set.intersection(first);
    console.log("Set.prototype.intersection, form 3, is it an operand:", result === set, result === first);
    const again = set.intersection(first);
    console.log("Set.prototype.intersection, form 3, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.intersection, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.intersection, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.intersection, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.intersection, form 3, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.intersection, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.intersection, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.intersection, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.intersection, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.intersection, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.intersection, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const first = new Set([1.5, item]);
    const result = set.isDisjointFrom(first);
    console.log("Set.prototype.isDisjointFrom, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isDisjointFrom:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isDisjointFrom, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isDisjointFrom: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const first = new Set([item]);
    const result = set.isDisjointFrom(first);
    console.log("Set.prototype.isDisjointFrom, form 2, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isDisjointFrom, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isDisjointFrom, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isDisjointFrom, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const first = new Set();
    const result = set.isDisjointFrom(first);
    console.log("Set.prototype.isDisjointFrom, form 3, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isDisjointFrom, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isDisjointFrom, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isDisjointFrom, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const first = new Set([1.5, item]);
    const result = set.isSubsetOf(first);
    console.log("Set.prototype.isSubsetOf, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isSubsetOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isSubsetOf, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isSubsetOf: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const first = new Set([item]);
    const result = set.isSubsetOf(first);
    console.log("Set.prototype.isSubsetOf, form 2, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isSubsetOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isSubsetOf, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isSubsetOf, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const first = new Set();
    const result = set.isSubsetOf(first);
    console.log("Set.prototype.isSubsetOf, form 3, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isSubsetOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isSubsetOf, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isSubsetOf, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const first = new Set([1.5, item]);
    const result = set.isSupersetOf(first);
    console.log("Set.prototype.isSupersetOf, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isSupersetOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isSupersetOf, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isSupersetOf: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const first = new Set([item]);
    const result = set.isSupersetOf(first);
    console.log("Set.prototype.isSupersetOf, form 2, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isSupersetOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isSupersetOf, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isSupersetOf, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const first = new Set();
    const result = set.isSupersetOf(first);
    console.log("Set.prototype.isSupersetOf, form 3, is it an operand:", result === set, result === first);
    console.log("Set.prototype.isSupersetOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.isSupersetOf, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Set.prototype.isSupersetOf, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const result = set.size;
    console.log("Set.prototype.size, get, is it an operand:", result === set);
    console.log("Set.prototype.size, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Set.prototype.size, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.size, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Set.prototype.size, get: it threw", error instanceof Error);
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
    const set = new Set([item]);
    const result = set.size;
    console.log("Set.prototype.size, get, form 2, is it an operand:", result === set);
    console.log("Set.prototype.size, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Set.prototype.size, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.size, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Set.prototype.size, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const set = new Set();
    const result = set.size;
    console.log("Set.prototype.size, get, form 3, is it an operand:", result === set);
    console.log("Set.prototype.size, get, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Set.prototype.size, get, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.size, get, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Set.prototype.size, get, form 3: it threw", error instanceof Error);
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
    const set = new Set([1.5, item]);
    const first = new Set([1.5, item]);
    const result = set.symmetricDifference(first);
    console.log("Set.prototype.symmetricDifference, is it an operand:", result === set, result === first);
    const again = set.symmetricDifference(first);
    console.log("Set.prototype.symmetricDifference, does a second call answer the same thing:", result === again);
    console.log("Set.prototype.symmetricDifference:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Set.prototype.symmetricDifference, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Set.prototype.symmetricDifference, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Set.prototype.symmetricDifference, its own class:", Object.getPrototypeOf(result) === Set.prototype, Reflect.getPrototypeOf(result) === Set.prototype, result.constructor === Set, Object.getPrototypeOf(result) === Object.getPrototypeOf(Set.prototype));
    console.log("Set.prototype.symmetricDifference, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Set.prototype.symmetricDifference, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Set.prototype.symmetricDifference, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Set.prototype.symmetricDifference, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Set.prototype.symmetricDifference, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Set.prototype.symmetricDifference: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
