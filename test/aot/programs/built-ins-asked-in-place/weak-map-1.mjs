// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = WeakMap.length;
    console.log("WeakMap.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("WeakMap.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = WeakMap.name;
    console.log("WeakMap.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakMap.name, get: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.delete(key);
    console.log("WeakMap.prototype.delete, is it an operand:", result === subject);
    console.log("WeakMap.prototype.delete:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.delete, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.delete: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.delete(1.5);
    console.log("WeakMap.prototype.delete, form 2, is it an operand:", result === subject);
    console.log("WeakMap.prototype.delete, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.delete, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.delete, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.delete(key);
    console.log("WeakMap.prototype.delete, form 3, is it an operand:", result === subject);
    console.log("WeakMap.prototype.delete, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.delete, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.delete, form 3: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.get(key);
    console.log("WeakMap.prototype.get, is it an operand:", result === subject);
    console.log("WeakMap.prototype.get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.get, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.get, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.get, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.get, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.get.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.get.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.get: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.get(1.5);
    console.log("WeakMap.prototype.get, form 2, is it an operand:", result === subject);
    console.log("WeakMap.prototype.get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("WeakMap.prototype.get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.get(key);
    console.log("WeakMap.prototype.get, form 3, is it an operand:", result === subject);
    console.log("WeakMap.prototype.get, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("WeakMap.prototype.get, form 3: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert(key, 2.5);
    console.log("WeakMap.prototype.getOrInsert, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert.call(subject, key, 2.5);
    console.log("WeakMap.prototype.getOrInsert, by call, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, by call.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, by call.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert.apply(subject, [key, 2.5]);
    console.log("WeakMap.prototype.getOrInsert, by apply, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, by apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, by apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = Reflect.apply(subject.getOrInsert, subject, [key, 2.5]);
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert.bind(subject)(key, 2.5);
    console.log("WeakMap.prototype.getOrInsert, by a bound function, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, by a bound function.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, by a bound function.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.getOrInsert(first, 2.5);
    console.log("WeakMap.prototype.getOrInsert, form 6, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.getOrInsert, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 6, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 6: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.getOrInsert.call(subject, first, 2.5);
    console.log("WeakMap.prototype.getOrInsert, form 6, by call, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.getOrInsert, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 6, by call, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 6, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.getOrInsert.apply(subject, [first, 2.5]);
    console.log("WeakMap.prototype.getOrInsert, form 6, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.getOrInsert, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 6, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 6, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(subject.getOrInsert, subject, [first, 2.5]);
    console.log("WeakMap.prototype.getOrInsert, form 6, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.getOrInsert, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 6, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.getOrInsert.bind(subject)(first, 2.5);
    console.log("WeakMap.prototype.getOrInsert, form 6, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.getOrInsert, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 6, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 6, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert(key, item);
    console.log("WeakMap.prototype.getOrInsert, form 11, is it an operand:", result === subject, result === item);
    console.log("WeakMap.prototype.getOrInsert, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, form 11, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, form 11.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, form 11.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 11: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert.call(subject, key, item);
    console.log("WeakMap.prototype.getOrInsert, form 11, by call, is it an operand:", result === subject, result === item);
    console.log("WeakMap.prototype.getOrInsert, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, form 11, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, form 11, by call.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by call.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 11, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert.apply(subject, [key, item]);
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply, is it an operand:", result === subject, result === item);
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 11, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = Reflect.apply(subject.getOrInsert, subject, [key, item]);
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, is it an operand:", result === subject, result === item);
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.getOrInsert.bind(subject)(key, item);
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, is it an operand:", result === subject, result === item);
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.getOrInsert(key, 2.5);
    console.log("WeakMap.prototype.getOrInsert, form 16, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 16, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.getOrInsert.call(subject, key, 2.5);
    console.log("WeakMap.prototype.getOrInsert, form 16, by call, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, form 16, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 16, by call, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 16, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.getOrInsert.apply(subject, [key, 2.5]);
    console.log("WeakMap.prototype.getOrInsert, form 16, by apply, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 16, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 16, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = Reflect.apply(subject.getOrInsert, subject, [key, 2.5]);
    console.log("WeakMap.prototype.getOrInsert, form 16, by Reflect.apply, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 16, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 16, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.getOrInsert.bind(subject)(key, 2.5);
    console.log("WeakMap.prototype.getOrInsert, form 16, by a bound function, is it an operand:", result === subject);
    console.log("WeakMap.prototype.getOrInsert, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsert, form 16, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsert, form 16, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.getOrInsertComputed(first, callback);
    console.log("WeakMap.prototype.getOrInsertComputed, is it an operand:", result === subject, result === first, result === callback);
    console.log("WeakMap.prototype.getOrInsertComputed:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsertComputed, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsertComputed: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = subject.getOrInsertComputed(first, callback);
    console.log("WeakMap.prototype.getOrInsertComputed, form 2, is it an operand:", result === subject, result === first, result === callback);
    console.log("WeakMap.prototype.getOrInsertComputed, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsertComputed, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsertComputed, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
