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
    const first = { first: 1.5, second: "two", third: item };
    const result = Object.assign(first, 2.5, "-");
    console.log("Object.assign, is it an operand:", result === first);
    console.log("Object.assign:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign: it threw", error instanceof Error);
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
    const result = Object.assign.call(Object, first, 2.5, "-");
    console.log("Object.assign, by call, is it an operand:", result === first);
    console.log("Object.assign, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, by call: it threw", error instanceof Error);
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
    const result = Object.assign.apply(Object, [first, 2.5, "-"]);
    console.log("Object.assign, by apply, is it an operand:", result === first);
    console.log("Object.assign, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(Object.assign, Object, [first, 2.5, "-"]);
    console.log("Object.assign, by Reflect.apply, is it an operand:", result === first);
    console.log("Object.assign, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, by Reflect.apply: it threw", error instanceof Error);
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
    const result = Object.assign.bind(Object)(first, 2.5, "-");
    console.log("Object.assign, by a bound function, is it an operand:", result === first);
    console.log("Object.assign, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, by a bound function: it threw", error instanceof Error);
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
    const result = Object.assign(first, 2.5, "-");
    console.log("Object.assign, form 6, is it an operand:", result === first);
    console.log("Object.assign, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 6, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.assign, form 6, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 6: it threw", error instanceof Error);
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
    const result = Object.assign.call(Object, first, 2.5, "-");
    console.log("Object.assign, form 6, by call, is it an operand:", result === first);
    console.log("Object.assign, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 6, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.assign, form 6, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 6, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 6, by call: it threw", error instanceof Error);
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
    const result = Object.assign.apply(Object, [first, 2.5, "-"]);
    console.log("Object.assign, form 6, by apply, is it an operand:", result === first);
    console.log("Object.assign, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 6, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.assign, form 6, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 6, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 6, by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(Object.assign, Object, [first, 2.5, "-"]);
    console.log("Object.assign, form 6, by Reflect.apply, is it an operand:", result === first);
    console.log("Object.assign, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 6, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.assign, form 6, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 6, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const result = Object.assign.bind(Object)(first, 2.5, "-");
    console.log("Object.assign, form 6, by a bound function, is it an operand:", result === first);
    console.log("Object.assign, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 6, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.assign, form 6, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 6, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 6, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 6, by a bound function: it threw", error instanceof Error);
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
    const result = Object.assign(first, item, 2.5);
    console.log("Object.assign, form 11, is it an operand:", result === first, result === item);
    console.log("Object.assign, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 11, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 11.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 11.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 11.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 11.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 11.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 11.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 11.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 11.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 11.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 11.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 11.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 11.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
    console.log("Object.assign, form 11.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 11.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 11: it threw", error instanceof Error);
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
    const result = Object.assign.call(Object, first, item, 2.5);
    console.log("Object.assign, form 11, by call, is it an operand:", result === first, result === item);
    console.log("Object.assign, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 11, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 11, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 11, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 11, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 11, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 11, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 11, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 11, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 11, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 11, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 11, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 11, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 11, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
    console.log("Object.assign, form 11, by call.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 11, by call.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 11, by call: it threw", error instanceof Error);
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
    const result = Object.assign.apply(Object, [first, item, 2.5]);
    console.log("Object.assign, form 11, by apply, is it an operand:", result === first, result === item);
    console.log("Object.assign, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 11, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 11, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 11, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 11, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 11, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 11, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 11, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 11, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 11, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 11, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 11, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 11, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 11, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
    console.log("Object.assign, form 11, by apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 11, by apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 11, by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(Object.assign, Object, [first, item, 2.5]);
    console.log("Object.assign, form 11, by Reflect.apply, is it an operand:", result === first, result === item);
    console.log("Object.assign, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 11, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 11, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 11, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 11, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 11, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 11, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 11, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 11, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 11, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 11, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 11, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 11, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
    console.log("Object.assign, form 11, by Reflect.apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 11, by Reflect.apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const result = Object.assign.bind(Object)(first, item, 2.5);
    console.log("Object.assign, form 11, by a bound function, is it an operand:", result === first, result === item);
    console.log("Object.assign, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 11, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 11, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 11, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 11, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 11, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 11, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 11, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 11, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 11, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 11, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 11, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 11, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 11, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 11, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
    console.log("Object.assign, form 11, by a bound function.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 11, by a bound function.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 11, by a bound function: it threw", error instanceof Error);
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
    const result = Object.assign(first, 2.5, "-");
    console.log("Object.assign, form 16, is it an operand:", result === first);
    console.log("Object.assign, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 16, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 16, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 16, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 16, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 16, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 16.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 16.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 16.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 16.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 16.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 16.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 16.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 16.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 16.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 16.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 16.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 16.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, form 16: it threw", error instanceof Error);
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
    const result = Object.assign.call(Object, first, 2.5, "-");
    console.log("Object.assign, form 16, by call, is it an operand:", result === first);
    console.log("Object.assign, form 16, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 16, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 16, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 16, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 16, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 16, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 16, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 16, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 16, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 16, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 16, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 16, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 16, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 16, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 16, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 16, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 16, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 16, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, form 16, by call: it threw", error instanceof Error);
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
    const result = Object.assign.apply(Object, [first, 2.5, "-"]);
    console.log("Object.assign, form 16, by apply, is it an operand:", result === first);
    console.log("Object.assign, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 16, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 16, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 16, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 16, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 16, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 16, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 16, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 16, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 16, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 16, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 16, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 16, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 16, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 16, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 16, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 16, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 16, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, form 16, by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(Object.assign, Object, [first, 2.5, "-"]);
    console.log("Object.assign, form 16, by Reflect.apply, is it an operand:", result === first);
    console.log("Object.assign, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 16, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 16, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 16, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 16, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 16, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 16, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 16, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 16, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 16, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 16, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 16, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 16, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 16, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 16, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 16, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 16, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 16, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, form 16, by Reflect.apply: it threw", error instanceof Error);
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
    const result = Object.assign.bind(Object)(first, 2.5, "-");
    console.log("Object.assign, form 16, by a bound function, is it an operand:", result === first);
    console.log("Object.assign, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 16, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 16, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 16, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 16, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 16, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 16, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 16, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 16, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 16, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 16, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 16, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 16, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 16, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 16, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 16, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 16, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 16, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 16, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.assign, form 16, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(true, 2.5, "-");
    const again = Object.assign(true, 2.5, "-");
    console.log("Object.assign, form 21, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 21:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 21, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 21, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 21, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 21, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 21, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 21, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 21, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 21, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 21: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(true, "-", "-");
    const again = Object.assign(true, "-", "-");
    console.log("Object.assign, form 22, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 22:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 22, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 22, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 22, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 22, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 22, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 22, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 22, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 22, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 22: it threw", error instanceof Error);
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
    const result = Object.assign(true, item, 2.5);
    console.log("Object.assign, form 23, is it an operand:", result === item);
    const again = Object.assign(true, item, 2.5);
    console.log("Object.assign, form 23, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 23:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 23, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 23, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 23, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 23, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 23, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 23, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 23, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 23, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 23.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 23.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 23: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(1.5, 2.5, "-");
    const again = Object.assign(1.5, 2.5, "-");
    console.log("Object.assign, form 24, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 24:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 24, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 24, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 24, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 24, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 24, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 24, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 24, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 24, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 24: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(1.5, "-", "-");
    const again = Object.assign(1.5, "-", "-");
    console.log("Object.assign, form 25, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 25:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 25, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 25, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 25, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 25, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 25, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 25, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 25, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 25, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 25: it threw", error instanceof Error);
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
    const result = Object.assign(1.5, item, 2.5);
    console.log("Object.assign, form 26, is it an operand:", result === item);
    const again = Object.assign(1.5, item, 2.5);
    console.log("Object.assign, form 26, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 26:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 26, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 26, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 26, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 26, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 26, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 26, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 26, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 26, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 26.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 26.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Object.assign, form 26: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign("an", 2.5, 2.5);
    const again = Object.assign("an", 2.5, 2.5);
    console.log("Object.assign, form 27, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 27:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 27, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 27, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 27, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 27, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 27, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 27, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 27, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 27, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 27, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 27, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 27: it threw", error instanceof Error);
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
    const result = Object.assign("an", second, 2.5);
    console.log("Object.assign, form 28, is it an operand:", result === second);
    const again = Object.assign("an", second, 2.5);
    console.log("Object.assign, form 28, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 28:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 28, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 28, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 28, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 28, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 28, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 28.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.assign, form 28.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.assign, form 28.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.assign, form 28.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.assign, form 28.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.assign, form 28.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.assign, form 28.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.assign, form 28.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.assign, form 28.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.assign, form 28.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.assign, form 28.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.assign, form 28.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 28, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 28, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 28: it threw", error instanceof Error);
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
    const result = Object.assign("an", item, 2.5);
    console.log("Object.assign, form 29, is it an operand:", result === item);
    const again = Object.assign("an", item, 2.5);
    console.log("Object.assign, form 29, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 29:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 29, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 29, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 29, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 29, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 29, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 29, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 29, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 29, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.assign, form 29.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Object.assign, form 29.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 29, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.assign, form 29, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 29: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.assign(Symbol.for("name"), 2.5, "-");
    const again = Object.assign(Symbol.for("name"), 2.5, "-");
    console.log("Object.assign, form 30, does a second call answer the same thing:", result === again);
    console.log("Object.assign, form 30:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.assign, form 30, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.assign, form 30, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.assign, form 30, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.assign, form 30, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.assign, form 30, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 30, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 30, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.assign, form 30, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
  } catch (error) {
    console.log("Object.assign, form 30: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
