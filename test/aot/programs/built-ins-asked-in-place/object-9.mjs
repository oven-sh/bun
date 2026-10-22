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
    const subject = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(subject.valueOf, subject, []);
    console.log("Object.prototype.valueOf, by Reflect.apply, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.prototype.valueOf, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.prototype.valueOf, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.prototype.valueOf, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.prototype.valueOf, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.prototype.valueOf, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.prototype.valueOf, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.prototype.valueOf, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.prototype.valueOf, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.valueOf.bind(subject)();
    console.log("Object.prototype.valueOf, by a bound function, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.prototype.valueOf, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.prototype.valueOf, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.prototype.valueOf, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.prototype.valueOf, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.prototype.valueOf, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.prototype.valueOf, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.prototype.valueOf, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.prototype.valueOf, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, by a bound function: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.valueOf();
    console.log("Object.prototype.valueOf, form 6, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 6.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.prototype.valueOf, form 6.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.prototype.valueOf, form 6.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.prototype.valueOf, form 6.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.prototype.valueOf, form 6.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6.first.size:", typeof result.first.size === "undefined", typeof result.first.size === "boolean", typeof result.first.size === "number", typeof result.first.size === "string", typeof result.first.size === "bigint", typeof result.first.size === "symbol", typeof result.first.size === "function", typeof result.first.size === "object", result.first.size === null);
    console.log("Object.prototype.valueOf, form 6.first.size, the number:", Number.isInteger(result.first.size), result.first.size === result.first.size, result.first.size < 0, result.first.size > 2147483647, result.first.size < -2147483648, Object.is(result.first.size, -0), (result.first.size | 0) === result.first.size);
    console.log("Object.prototype.valueOf, form 6.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 6.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.prototype.valueOf, form 6.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.prototype.valueOf, form 6.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.prototype.valueOf, form 6.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.prototype.valueOf, form 6.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.prototype.valueOf, form 6.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 6: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.valueOf.call(subject);
    console.log("Object.prototype.valueOf, form 6, by call, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 6, by call.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.prototype.valueOf, form 6, by call.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.prototype.valueOf, form 6, by call.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.prototype.valueOf, form 6, by call.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.prototype.valueOf, form 6, by call.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by call.first.size:", typeof result.first.size === "undefined", typeof result.first.size === "boolean", typeof result.first.size === "number", typeof result.first.size === "string", typeof result.first.size === "bigint", typeof result.first.size === "symbol", typeof result.first.size === "function", typeof result.first.size === "object", result.first.size === null);
    console.log("Object.prototype.valueOf, form 6, by call.first.size, the number:", Number.isInteger(result.first.size), result.first.size === result.first.size, result.first.size < 0, result.first.size > 2147483647, result.first.size < -2147483648, Object.is(result.first.size, -0), (result.first.size | 0) === result.first.size);
    console.log("Object.prototype.valueOf, form 6, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 6, by call.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.prototype.valueOf, form 6, by call.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.prototype.valueOf, form 6, by call.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.prototype.valueOf, form 6, by call.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.prototype.valueOf, form 6, by call.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by call.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by call.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.prototype.valueOf, form 6, by call.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 6, by call: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.valueOf.apply(subject, []);
    console.log("Object.prototype.valueOf, form 6, by apply, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 6, by apply.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.prototype.valueOf, form 6, by apply.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.prototype.valueOf, form 6, by apply.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.prototype.valueOf, form 6, by apply.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.prototype.valueOf, form 6, by apply.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by apply.first.size:", typeof result.first.size === "undefined", typeof result.first.size === "boolean", typeof result.first.size === "number", typeof result.first.size === "string", typeof result.first.size === "bigint", typeof result.first.size === "symbol", typeof result.first.size === "function", typeof result.first.size === "object", result.first.size === null);
    console.log("Object.prototype.valueOf, form 6, by apply.first.size, the number:", Number.isInteger(result.first.size), result.first.size === result.first.size, result.first.size < 0, result.first.size > 2147483647, result.first.size < -2147483648, Object.is(result.first.size, -0), (result.first.size | 0) === result.first.size);
    console.log("Object.prototype.valueOf, form 6, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 6, by apply.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.prototype.valueOf, form 6, by apply.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.prototype.valueOf, form 6, by apply.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.prototype.valueOf, form 6, by apply.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.prototype.valueOf, form 6, by apply.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by apply.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by apply.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.prototype.valueOf, form 6, by apply.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 6, by apply: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = Reflect.apply(subject.valueOf, subject, []);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first.size:", typeof result.first.size === "undefined", typeof result.first.size === "boolean", typeof result.first.size === "number", typeof result.first.size === "string", typeof result.first.size === "bigint", typeof result.first.size === "symbol", typeof result.first.size === "function", typeof result.first.size === "object", result.first.size === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.first.size, the number:", Number.isInteger(result.first.size), result.first.size === result.first.size, result.first.size < 0, result.first.size > 2147483647, result.first.size < -2147483648, Object.is(result.first.size, -0), (result.first.size | 0) === result.first.size);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.valueOf.bind(subject)();
    console.log("Object.prototype.valueOf, form 6, by a bound function, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.prototype.valueOf, form 6, by a bound function.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.prototype.valueOf, form 6, by a bound function.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.prototype.valueOf, form 6, by a bound function.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by a bound function.first.size:", typeof result.first.size === "undefined", typeof result.first.size === "boolean", typeof result.first.size === "number", typeof result.first.size === "string", typeof result.first.size === "bigint", typeof result.first.size === "symbol", typeof result.first.size === "function", typeof result.first.size === "object", result.first.size === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function.first.size, the number:", Number.isInteger(result.first.size), result.first.size === result.first.size, result.first.size < 0, result.first.size > 2147483647, result.first.size < -2147483648, Object.is(result.first.size, -0), (result.first.size | 0) === result.first.size);
    console.log("Object.prototype.valueOf, form 6, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.prototype.valueOf, form 6, by a bound function.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.prototype.valueOf, form 6, by a bound function.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.prototype.valueOf, form 6, by a bound function.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 6, by a bound function.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 6, by a bound function.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.prototype.valueOf, form 6, by a bound function.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.valueOf();
    console.log("Object.prototype.valueOf, form 11, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 11: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.valueOf.call(subject);
    console.log("Object.prototype.valueOf, form 11, by call, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 11, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 11, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.valueOf.apply(subject, []);
    console.log("Object.prototype.valueOf, form 11, by apply, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 11, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 11, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = Reflect.apply(subject.valueOf, subject, []);
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 11, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.valueOf.bind(subject)();
    console.log("Object.prototype.valueOf, form 11, by a bound function, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 11, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 11, by a bound function: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.valueOf();
    console.log("Object.prototype.valueOf, form 16, is it an operand:", result === subject);
    const again = subject.valueOf();
    console.log("Object.prototype.valueOf, form 16, does a second call answer the same thing:", result === again);
    console.log("Object.prototype.valueOf, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 16, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 16, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 16, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 16, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 16, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 16, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 16, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 16, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 16.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 16.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.prototype.valueOf, form 16.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 16.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.prototype.valueOf, form 16.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.prototype.valueOf, form 16.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.prototype.valueOf, form 16.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.prototype.valueOf, form 16.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.prototype.valueOf, form 16.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.prototype.valueOf, form 16.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 16.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 16.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 16.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 16.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.prototype.valueOf, form 16.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 16: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.valueOf();
    console.log("Object.prototype.valueOf, form 17, is it an operand:", result === subject);
    const again = subject.valueOf();
    console.log("Object.prototype.valueOf, form 17, does a second call answer the same thing:", result === again);
    console.log("Object.prototype.valueOf, form 17:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 17, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 17, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 17, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 17, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 17, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 17.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, form 17.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.prototype.valueOf, form 17.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.prototype.valueOf, form 17.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.prototype.valueOf, form 17.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.prototype.valueOf, form 17.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 17.first.size:", typeof result.first.size === "undefined", typeof result.first.size === "boolean", typeof result.first.size === "number", typeof result.first.size === "string", typeof result.first.size === "bigint", typeof result.first.size === "symbol", typeof result.first.size === "function", typeof result.first.size === "object", result.first.size === null);
    console.log("Object.prototype.valueOf, form 17.first.size, the number:", Number.isInteger(result.first.size), result.first.size === result.first.size, result.first.size < 0, result.first.size > 2147483647, result.first.size < -2147483648, Object.is(result.first.size, -0), (result.first.size | 0) === result.first.size);
    console.log("Object.prototype.valueOf, form 17.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, form 17.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.prototype.valueOf, form 17.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.prototype.valueOf, form 17.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.prototype.valueOf, form 17.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.prototype.valueOf, form 17.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, form 17.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, form 17.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.prototype.valueOf, form 17.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 17: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.valueOf();
    console.log("Object.prototype.valueOf, form 18, is it an operand:", result === subject);
    const again = subject.valueOf();
    console.log("Object.prototype.valueOf, form 18, does a second call answer the same thing:", result === again);
    console.log("Object.prototype.valueOf, form 18:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, form 18, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, form 18, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, form 18, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, form 18, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, form 18, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.valueOf, form 18: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
