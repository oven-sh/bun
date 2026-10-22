// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Object.freeze.apply(Object, [1.5]);
    console.log("Object.freeze, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.freeze, form 16, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Object.freeze, form 16, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Reflect.apply(Object.freeze, Object, [1.5]);
    console.log("Object.freeze, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.freeze, form 16, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Object.freeze, form 16, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.freeze.bind(Object)(1.5);
    console.log("Object.freeze, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.freeze, form 16, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Object.freeze, form 16, by a bound function: it threw", error instanceof Error);
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
    const first = [["first", 1.5], ["second", item]];
    const result = Object.fromEntries(first);
    console.log("Object.fromEntries, is it an operand:", result === first);
    const again = Object.fromEntries(first);
    console.log("Object.fromEntries, does a second call answer the same thing:", result === again);
    console.log("Object.fromEntries:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.fromEntries, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.fromEntries, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.fromEntries, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.fromEntries, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.fromEntries, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.fromEntries.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.fromEntries.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.fromEntries.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.fromEntries.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.fromEntries.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.fromEntries.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.fromEntries.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.fromEntries.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.fromEntries.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.fromEntries.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.fromEntries: it threw", error instanceof Error);
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
    const first = [["first", 1.5], ["second", item]];
    const result = Object.fromEntries(first);
    console.log("Object.fromEntries, form 2, is it an operand:", result === first);
    const again = Object.fromEntries(first);
    console.log("Object.fromEntries, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.fromEntries, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.fromEntries, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.fromEntries, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.fromEntries, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.fromEntries, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.fromEntries, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.fromEntries, form 2.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.fromEntries, form 2.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.fromEntries, form 2.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.fromEntries, form 2.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.fromEntries, form 2.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.fromEntries, form 2.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.fromEntries, form 2.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.fromEntries, form 2.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, form 2.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, form 2.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.fromEntries, form 2.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.fromEntries, form 2.second.size:", typeof result.second.size === "undefined", typeof result.second.size === "boolean", typeof result.second.size === "number", typeof result.second.size === "string", typeof result.second.size === "bigint", typeof result.second.size === "symbol", typeof result.second.size === "function", typeof result.second.size === "object", result.second.size === null);
    console.log("Object.fromEntries, form 2.second.size, the number:", Number.isInteger(result.second.size), result.second.size === result.second.size, result.second.size < 0, result.second.size > 2147483647, result.second.size < -2147483648, Object.is(result.second.size, -0), (result.second.size | 0) === result.second.size);
  } catch (error) {
    console.log("Object.fromEntries, form 2: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyDescriptor(first, "-");
    console.log("Object.getOwnPropertyDescriptor, is it an operand:", result === first);
    const again = Object.getOwnPropertyDescriptor(first, "-");
    console.log("Object.getOwnPropertyDescriptor, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyDescriptor:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.getOwnPropertyDescriptor: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyDescriptor(first, "-");
    console.log("Object.getOwnPropertyDescriptor, form 2, is it an operand:", result === first);
    const again = Object.getOwnPropertyDescriptor(first, "-");
    console.log("Object.getOwnPropertyDescriptor, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyDescriptor, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.getOwnPropertyDescriptor, form 2: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyDescriptor(first, "-");
    console.log("Object.getOwnPropertyDescriptor, form 3, is it an operand:", result === first);
    const again = Object.getOwnPropertyDescriptor(first, "-");
    console.log("Object.getOwnPropertyDescriptor, form 3, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyDescriptor, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.getOwnPropertyDescriptor, form 3: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyDescriptors(first);
    console.log("Object.getOwnPropertyDescriptors, is it an operand:", result === first);
    const again = Object.getOwnPropertyDescriptors(first);
    console.log("Object.getOwnPropertyDescriptors, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyDescriptors:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertyDescriptors, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertyDescriptors, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertyDescriptors, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertyDescriptors, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertyDescriptors, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.getOwnPropertyDescriptors.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.getOwnPropertyDescriptors.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.getOwnPropertyDescriptors.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.getOwnPropertyDescriptors.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.getOwnPropertyDescriptors.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors.first.value:", typeof result.first.value === "undefined", typeof result.first.value === "boolean", typeof result.first.value === "number", typeof result.first.value === "string", typeof result.first.value === "bigint", typeof result.first.value === "symbol", typeof result.first.value === "function", typeof result.first.value === "object", result.first.value === null);
    console.log("Object.getOwnPropertyDescriptors.first.value, the number:", Number.isInteger(result.first.value), result.first.value === result.first.value, result.first.value < 0, result.first.value > 2147483647, result.first.value < -2147483648, Object.is(result.first.value, -0), (result.first.value | 0) === result.first.value);
    console.log("Object.getOwnPropertyDescriptors.first.writable:", typeof result.first.writable === "undefined", typeof result.first.writable === "boolean", typeof result.first.writable === "number", typeof result.first.writable === "string", typeof result.first.writable === "bigint", typeof result.first.writable === "symbol", typeof result.first.writable === "function", typeof result.first.writable === "object", result.first.writable === null);
    console.log("Object.getOwnPropertyDescriptors.first.writable, the boolean:", result.first.writable === true, result.first.writable === false, !result.first.writable);
    console.log("Object.getOwnPropertyDescriptors.first.enumerable:", typeof result.first.enumerable === "undefined", typeof result.first.enumerable === "boolean", typeof result.first.enumerable === "number", typeof result.first.enumerable === "string", typeof result.first.enumerable === "bigint", typeof result.first.enumerable === "symbol", typeof result.first.enumerable === "function", typeof result.first.enumerable === "object", result.first.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors.first.enumerable, the boolean:", result.first.enumerable === true, result.first.enumerable === false, !result.first.enumerable);
    console.log("Object.getOwnPropertyDescriptors.first.configurable:", typeof result.first.configurable === "undefined", typeof result.first.configurable === "boolean", typeof result.first.configurable === "number", typeof result.first.configurable === "string", typeof result.first.configurable === "bigint", typeof result.first.configurable === "symbol", typeof result.first.configurable === "function", typeof result.first.configurable === "object", result.first.configurable === null);
    console.log("Object.getOwnPropertyDescriptors.first.configurable, the boolean:", result.first.configurable === true, result.first.configurable === false, !result.first.configurable);
    console.log("Object.getOwnPropertyDescriptors.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.getOwnPropertyDescriptors.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.getOwnPropertyDescriptors.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.getOwnPropertyDescriptors.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.getOwnPropertyDescriptors.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.getOwnPropertyDescriptors.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors.second.value:", typeof result.second.value === "undefined", typeof result.second.value === "boolean", typeof result.second.value === "number", typeof result.second.value === "string", typeof result.second.value === "bigint", typeof result.second.value === "symbol", typeof result.second.value === "function", typeof result.second.value === "object", result.second.value === null);
    console.log("Object.getOwnPropertyDescriptors.second.value, the text:", result.second.value.length === 0, result.second.value === "");
    console.log("Object.getOwnPropertyDescriptors.second.writable:", typeof result.second.writable === "undefined", typeof result.second.writable === "boolean", typeof result.second.writable === "number", typeof result.second.writable === "string", typeof result.second.writable === "bigint", typeof result.second.writable === "symbol", typeof result.second.writable === "function", typeof result.second.writable === "object", result.second.writable === null);
    console.log("Object.getOwnPropertyDescriptors.second.writable, the boolean:", result.second.writable === true, result.second.writable === false, !result.second.writable);
    console.log("Object.getOwnPropertyDescriptors.second.enumerable:", typeof result.second.enumerable === "undefined", typeof result.second.enumerable === "boolean", typeof result.second.enumerable === "number", typeof result.second.enumerable === "string", typeof result.second.enumerable === "bigint", typeof result.second.enumerable === "symbol", typeof result.second.enumerable === "function", typeof result.second.enumerable === "object", result.second.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors.second.enumerable, the boolean:", result.second.enumerable === true, result.second.enumerable === false, !result.second.enumerable);
    console.log("Object.getOwnPropertyDescriptors.second.configurable:", typeof result.second.configurable === "undefined", typeof result.second.configurable === "boolean", typeof result.second.configurable === "number", typeof result.second.configurable === "string", typeof result.second.configurable === "bigint", typeof result.second.configurable === "symbol", typeof result.second.configurable === "function", typeof result.second.configurable === "object", result.second.configurable === null);
    console.log("Object.getOwnPropertyDescriptors.second.configurable, the boolean:", result.second.configurable === true, result.second.configurable === false, !result.second.configurable);
    console.log("Object.getOwnPropertyDescriptors.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.getOwnPropertyDescriptors.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.getOwnPropertyDescriptors.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.getOwnPropertyDescriptors.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.getOwnPropertyDescriptors.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.getOwnPropertyDescriptors.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors.third.value:", typeof result.third.value === "undefined", typeof result.third.value === "boolean", typeof result.third.value === "number", typeof result.third.value === "string", typeof result.third.value === "bigint", typeof result.third.value === "symbol", typeof result.third.value === "function", typeof result.third.value === "object", result.third.value === null);
    console.log("Object.getOwnPropertyDescriptors.third.value, the class:", Array.isArray(result.third.value), result.third.value instanceof Object, result.third.value instanceof Array, result.third.value instanceof Map, result.third.value instanceof Set, result.third.value instanceof Promise, result.third.value instanceof Date, result.third.value instanceof RegExp, result.third.value instanceof Error, result.third.value instanceof ArrayBuffer, result.third.value instanceof Uint8Array, result.third.value instanceof Function, ArrayBuffer.isView(result.third.value));
    console.log("Object.getOwnPropertyDescriptors.third.value, above it:", Object.getPrototypeOf(result.third.value) === Object.prototype, Object.getPrototypeOf(result.third.value) === Array.prototype, Object.getPrototypeOf(result.third.value) === null);
    console.log("Object.getOwnPropertyDescriptors.third.value, its state:", Object.isFrozen(result.third.value), Object.isSealed(result.third.value), Object.isExtensible(result.third.value));
    console.log("Object.getOwnPropertyDescriptors.third.value, names in it:", "length" in result.third.value, "size" in result.third.value, "then" in result.third.value, "next" in result.third.value, "constructor" in result.third.value, Symbol.iterator in result.third.value);
    console.log("Object.getOwnPropertyDescriptors.third.writable:", typeof result.third.writable === "undefined", typeof result.third.writable === "boolean", typeof result.third.writable === "number", typeof result.third.writable === "string", typeof result.third.writable === "bigint", typeof result.third.writable === "symbol", typeof result.third.writable === "function", typeof result.third.writable === "object", result.third.writable === null);
    console.log("Object.getOwnPropertyDescriptors.third.writable, the boolean:", result.third.writable === true, result.third.writable === false, !result.third.writable);
    console.log("Object.getOwnPropertyDescriptors.third.enumerable:", typeof result.third.enumerable === "undefined", typeof result.third.enumerable === "boolean", typeof result.third.enumerable === "number", typeof result.third.enumerable === "string", typeof result.third.enumerable === "bigint", typeof result.third.enumerable === "symbol", typeof result.third.enumerable === "function", typeof result.third.enumerable === "object", result.third.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors.third.enumerable, the boolean:", result.third.enumerable === true, result.third.enumerable === false, !result.third.enumerable);
    console.log("Object.getOwnPropertyDescriptors.third.configurable:", typeof result.third.configurable === "undefined", typeof result.third.configurable === "boolean", typeof result.third.configurable === "number", typeof result.third.configurable === "string", typeof result.third.configurable === "bigint", typeof result.third.configurable === "symbol", typeof result.third.configurable === "function", typeof result.third.configurable === "object", result.third.configurable === null);
    console.log("Object.getOwnPropertyDescriptors.third.configurable, the boolean:", result.third.configurable === true, result.third.configurable === false, !result.third.configurable);
  } catch (error) {
    console.log("Object.getOwnPropertyDescriptors: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyDescriptors(first);
    console.log("Object.getOwnPropertyDescriptors, form 2, is it an operand:", result === first);
    const again = Object.getOwnPropertyDescriptors(first);
    console.log("Object.getOwnPropertyDescriptors, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyDescriptors, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertyDescriptors, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertyDescriptors, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertyDescriptors, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertyDescriptors, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertyDescriptors, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors, form 2.length:", typeof result.length === "undefined", typeof result.length === "boolean", typeof result.length === "number", typeof result.length === "string", typeof result.length === "bigint", typeof result.length === "symbol", typeof result.length === "function", typeof result.length === "object", result.length === null);
    console.log("Object.getOwnPropertyDescriptors, form 2.length, the class:", Array.isArray(result.length), result.length instanceof Object, result.length instanceof Array, result.length instanceof Map, result.length instanceof Set, result.length instanceof Promise, result.length instanceof Date, result.length instanceof RegExp, result.length instanceof Error, result.length instanceof ArrayBuffer, result.length instanceof Uint8Array, result.length instanceof Function, ArrayBuffer.isView(result.length));
    console.log("Object.getOwnPropertyDescriptors, form 2.length, above it:", Object.getPrototypeOf(result.length) === Object.prototype, Object.getPrototypeOf(result.length) === Array.prototype, Object.getPrototypeOf(result.length) === null);
    console.log("Object.getOwnPropertyDescriptors, form 2.length, its state:", Object.isFrozen(result.length), Object.isSealed(result.length), Object.isExtensible(result.length));
    console.log("Object.getOwnPropertyDescriptors, form 2.length, names in it:", "length" in result.length, "size" in result.length, "then" in result.length, "next" in result.length, "constructor" in result.length, Symbol.iterator in result.length);
    console.log("Object.getOwnPropertyDescriptors, form 2.length, how many keys:", Object.keys(result.length).length);
    {
      let asked = 0;
      for (const value of Object.values(result.length)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 2.length, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.length)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 2.length, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.length) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 2.length, by for-in:", typeof key === "string", typeof result.length[key] === "undefined", typeof result.length[key] === "boolean", typeof result.length[key] === "number", typeof result.length[key] === "string", typeof result.length[key] === "bigint", typeof result.length[key] === "symbol", typeof result.length[key] === "function", typeof result.length[key] === "object", result.length[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors, form 2.length.value:", typeof result.length.value === "undefined", typeof result.length.value === "boolean", typeof result.length.value === "number", typeof result.length.value === "string", typeof result.length.value === "bigint", typeof result.length.value === "symbol", typeof result.length.value === "function", typeof result.length.value === "object", result.length.value === null);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.value, the number:", Number.isInteger(result.length.value), result.length.value === result.length.value, result.length.value < 0, result.length.value > 2147483647, result.length.value < -2147483648, Object.is(result.length.value, -0), (result.length.value | 0) === result.length.value);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.writable:", typeof result.length.writable === "undefined", typeof result.length.writable === "boolean", typeof result.length.writable === "number", typeof result.length.writable === "string", typeof result.length.writable === "bigint", typeof result.length.writable === "symbol", typeof result.length.writable === "function", typeof result.length.writable === "object", result.length.writable === null);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.writable, the boolean:", result.length.writable === true, result.length.writable === false, !result.length.writable);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.enumerable:", typeof result.length.enumerable === "undefined", typeof result.length.enumerable === "boolean", typeof result.length.enumerable === "number", typeof result.length.enumerable === "string", typeof result.length.enumerable === "bigint", typeof result.length.enumerable === "symbol", typeof result.length.enumerable === "function", typeof result.length.enumerable === "object", result.length.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.enumerable, the boolean:", result.length.enumerable === true, result.length.enumerable === false, !result.length.enumerable);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.configurable:", typeof result.length.configurable === "undefined", typeof result.length.configurable === "boolean", typeof result.length.configurable === "number", typeof result.length.configurable === "string", typeof result.length.configurable === "bigint", typeof result.length.configurable === "symbol", typeof result.length.configurable === "function", typeof result.length.configurable === "object", result.length.configurable === null);
    console.log("Object.getOwnPropertyDescriptors, form 2.length.configurable, the boolean:", result.length.configurable === true, result.length.configurable === false, !result.length.configurable);
  } catch (error) {
    console.log("Object.getOwnPropertyDescriptors, form 2: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyDescriptors(first);
    console.log("Object.getOwnPropertyDescriptors, form 3, is it an operand:", result === first);
    const again = Object.getOwnPropertyDescriptors(first);
    console.log("Object.getOwnPropertyDescriptors, form 3, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyDescriptors, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertyDescriptors, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertyDescriptors, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertyDescriptors, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertyDescriptors, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertyDescriptors, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors, form 3.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("Object.getOwnPropertyDescriptors, form 3.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("Object.getOwnPropertyDescriptors, form 3.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("Object.getOwnPropertyDescriptors, form 3.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors, form 3.first.value:", typeof result.first.value === "undefined", typeof result.first.value === "boolean", typeof result.first.value === "number", typeof result.first.value === "string", typeof result.first.value === "bigint", typeof result.first.value === "symbol", typeof result.first.value === "function", typeof result.first.value === "object", result.first.value === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.value, the number:", Number.isInteger(result.first.value), result.first.value === result.first.value, result.first.value < 0, result.first.value > 2147483647, result.first.value < -2147483648, Object.is(result.first.value, -0), (result.first.value | 0) === result.first.value);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.writable:", typeof result.first.writable === "undefined", typeof result.first.writable === "boolean", typeof result.first.writable === "number", typeof result.first.writable === "string", typeof result.first.writable === "bigint", typeof result.first.writable === "symbol", typeof result.first.writable === "function", typeof result.first.writable === "object", result.first.writable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.writable, the boolean:", result.first.writable === true, result.first.writable === false, !result.first.writable);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.enumerable:", typeof result.first.enumerable === "undefined", typeof result.first.enumerable === "boolean", typeof result.first.enumerable === "number", typeof result.first.enumerable === "string", typeof result.first.enumerable === "bigint", typeof result.first.enumerable === "symbol", typeof result.first.enumerable === "function", typeof result.first.enumerable === "object", result.first.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.enumerable, the boolean:", result.first.enumerable === true, result.first.enumerable === false, !result.first.enumerable);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.configurable:", typeof result.first.configurable === "undefined", typeof result.first.configurable === "boolean", typeof result.first.configurable === "number", typeof result.first.configurable === "string", typeof result.first.configurable === "bigint", typeof result.first.configurable === "symbol", typeof result.first.configurable === "function", typeof result.first.configurable === "object", result.first.configurable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.first.configurable, the boolean:", result.first.configurable === true, result.first.configurable === false, !result.first.configurable);
    console.log("Object.getOwnPropertyDescriptors, form 3.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("Object.getOwnPropertyDescriptors, form 3.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("Object.getOwnPropertyDescriptors, form 3.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("Object.getOwnPropertyDescriptors, form 3.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors, form 3.second.value:", typeof result.second.value === "undefined", typeof result.second.value === "boolean", typeof result.second.value === "number", typeof result.second.value === "string", typeof result.second.value === "bigint", typeof result.second.value === "symbol", typeof result.second.value === "function", typeof result.second.value === "object", result.second.value === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.second.value, the text:", result.second.value.length === 0, result.second.value === "");
    console.log("Object.getOwnPropertyDescriptors, form 3.second.writable:", typeof result.second.writable === "undefined", typeof result.second.writable === "boolean", typeof result.second.writable === "number", typeof result.second.writable === "string", typeof result.second.writable === "bigint", typeof result.second.writable === "symbol", typeof result.second.writable === "function", typeof result.second.writable === "object", result.second.writable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.second.writable, the boolean:", result.second.writable === true, result.second.writable === false, !result.second.writable);
    console.log("Object.getOwnPropertyDescriptors, form 3.second.enumerable:", typeof result.second.enumerable === "undefined", typeof result.second.enumerable === "boolean", typeof result.second.enumerable === "number", typeof result.second.enumerable === "string", typeof result.second.enumerable === "bigint", typeof result.second.enumerable === "symbol", typeof result.second.enumerable === "function", typeof result.second.enumerable === "object", result.second.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.second.enumerable, the boolean:", result.second.enumerable === true, result.second.enumerable === false, !result.second.enumerable);
    console.log("Object.getOwnPropertyDescriptors, form 3.second.configurable:", typeof result.second.configurable === "undefined", typeof result.second.configurable === "boolean", typeof result.second.configurable === "number", typeof result.second.configurable === "string", typeof result.second.configurable === "bigint", typeof result.second.configurable === "symbol", typeof result.second.configurable === "function", typeof result.second.configurable === "object", result.second.configurable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.second.configurable, the boolean:", result.second.configurable === true, result.second.configurable === false, !result.second.configurable);
    console.log("Object.getOwnPropertyDescriptors, form 3.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.getOwnPropertyDescriptors, form 3.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.getOwnPropertyDescriptors, form 3.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.getOwnPropertyDescriptors, form 3.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyDescriptors, form 3.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.getOwnPropertyDescriptors, form 3.third.value:", typeof result.third.value === "undefined", typeof result.third.value === "boolean", typeof result.third.value === "number", typeof result.third.value === "string", typeof result.third.value === "bigint", typeof result.third.value === "symbol", typeof result.third.value === "function", typeof result.third.value === "object", result.third.value === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.value, the class:", Array.isArray(result.third.value), result.third.value instanceof Object, result.third.value instanceof Array, result.third.value instanceof Map, result.third.value instanceof Set, result.third.value instanceof Promise, result.third.value instanceof Date, result.third.value instanceof RegExp, result.third.value instanceof Error, result.third.value instanceof ArrayBuffer, result.third.value instanceof Uint8Array, result.third.value instanceof Function, ArrayBuffer.isView(result.third.value));
    console.log("Object.getOwnPropertyDescriptors, form 3.third.value, above it:", Object.getPrototypeOf(result.third.value) === Object.prototype, Object.getPrototypeOf(result.third.value) === Array.prototype, Object.getPrototypeOf(result.third.value) === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.value, its state:", Object.isFrozen(result.third.value), Object.isSealed(result.third.value), Object.isExtensible(result.third.value));
    console.log("Object.getOwnPropertyDescriptors, form 3.third.value, names in it:", "length" in result.third.value, "size" in result.third.value, "then" in result.third.value, "next" in result.third.value, "constructor" in result.third.value, Symbol.iterator in result.third.value);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.writable:", typeof result.third.writable === "undefined", typeof result.third.writable === "boolean", typeof result.third.writable === "number", typeof result.third.writable === "string", typeof result.third.writable === "bigint", typeof result.third.writable === "symbol", typeof result.third.writable === "function", typeof result.third.writable === "object", result.third.writable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.writable, the boolean:", result.third.writable === true, result.third.writable === false, !result.third.writable);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.enumerable:", typeof result.third.enumerable === "undefined", typeof result.third.enumerable === "boolean", typeof result.third.enumerable === "number", typeof result.third.enumerable === "string", typeof result.third.enumerable === "bigint", typeof result.third.enumerable === "symbol", typeof result.third.enumerable === "function", typeof result.third.enumerable === "object", result.third.enumerable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.enumerable, the boolean:", result.third.enumerable === true, result.third.enumerable === false, !result.third.enumerable);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.configurable:", typeof result.third.configurable === "undefined", typeof result.third.configurable === "boolean", typeof result.third.configurable === "number", typeof result.third.configurable === "string", typeof result.third.configurable === "bigint", typeof result.third.configurable === "symbol", typeof result.third.configurable === "function", typeof result.third.configurable === "object", result.third.configurable === null);
    console.log("Object.getOwnPropertyDescriptors, form 3.third.configurable, the boolean:", result.third.configurable === true, result.third.configurable === false, !result.third.configurable);
  } catch (error) {
    console.log("Object.getOwnPropertyDescriptors, form 3: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyNames(first);
    console.log("Object.getOwnPropertyNames, is it an operand:", result === first);
    const again = Object.getOwnPropertyNames(first);
    console.log("Object.getOwnPropertyNames, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyNames:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertyNames, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertyNames, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertyNames, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertyNames, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertyNames, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.getOwnPropertyNames, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getOwnPropertyNames, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getOwnPropertyNames, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getOwnPropertyNames: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyNames(first);
    console.log("Object.getOwnPropertyNames, form 2, is it an operand:", result === first);
    const again = Object.getOwnPropertyNames(first);
    console.log("Object.getOwnPropertyNames, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyNames, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertyNames, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertyNames, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertyNames, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertyNames, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertyNames, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.getOwnPropertyNames, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getOwnPropertyNames, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getOwnPropertyNames, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getOwnPropertyNames, form 2: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertyNames(first);
    console.log("Object.getOwnPropertyNames, form 3, is it an operand:", result === first);
    const again = Object.getOwnPropertyNames(first);
    console.log("Object.getOwnPropertyNames, form 3, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertyNames, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertyNames, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertyNames, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertyNames, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertyNames, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertyNames, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.getOwnPropertyNames, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getOwnPropertyNames, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertyNames, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getOwnPropertyNames, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getOwnPropertyNames, form 3: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertySymbols(first);
    console.log("Object.getOwnPropertySymbols, is it an operand:", result === first);
    const again = Object.getOwnPropertySymbols(first);
    console.log("Object.getOwnPropertySymbols, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertySymbols:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertySymbols, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertySymbols, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertySymbols, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertySymbols, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertySymbols, how many keys:", Object.keys(result).length);
    console.log("Object.getOwnPropertySymbols, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getOwnPropertySymbols, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertySymbols, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getOwnPropertySymbols, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getOwnPropertySymbols: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertySymbols(first);
    console.log("Object.getOwnPropertySymbols, form 2, is it an operand:", result === first);
    const again = Object.getOwnPropertySymbols(first);
    console.log("Object.getOwnPropertySymbols, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertySymbols, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertySymbols, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertySymbols, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertySymbols, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertySymbols, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertySymbols, form 2, how many keys:", Object.keys(result).length);
    console.log("Object.getOwnPropertySymbols, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getOwnPropertySymbols, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertySymbols, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getOwnPropertySymbols, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getOwnPropertySymbols, form 2: it threw", error instanceof Error);
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
    const result = Object.getOwnPropertySymbols(first);
    console.log("Object.getOwnPropertySymbols, form 3, is it an operand:", result === first);
    const again = Object.getOwnPropertySymbols(first);
    console.log("Object.getOwnPropertySymbols, form 3, does a second call answer the same thing:", result === again);
    console.log("Object.getOwnPropertySymbols, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getOwnPropertySymbols, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getOwnPropertySymbols, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getOwnPropertySymbols, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.getOwnPropertySymbols, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getOwnPropertySymbols, form 3, how many keys:", Object.keys(result).length);
    console.log("Object.getOwnPropertySymbols, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getOwnPropertySymbols, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getOwnPropertySymbols, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getOwnPropertySymbols, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getOwnPropertySymbols, form 3: it threw", error instanceof Error);
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
    const result = Object.getPrototypeOf(first);
    console.log("Object.getPrototypeOf, is it an operand:", result === first);
    console.log("Object.getPrototypeOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.getPrototypeOf: it threw", error instanceof Error);
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
    const result = Object.getPrototypeOf(first);
    console.log("Object.getPrototypeOf, form 2, is it an operand:", result === first);
    console.log("Object.getPrototypeOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 2, how many keys:", Object.keys(result).length);
    console.log("Object.getPrototypeOf, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Object.getPrototypeOf, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getPrototypeOf, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getPrototypeOf, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getPrototypeOf, form 2: it threw", error instanceof Error);
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
    const result = Object.getPrototypeOf(first);
    console.log("Object.getPrototypeOf, form 3, is it an operand:", result === first);
    console.log("Object.getPrototypeOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.getPrototypeOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.getPrototypeOf(true);
    console.log("Object.getPrototypeOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.getPrototypeOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.getPrototypeOf(1.5);
    console.log("Object.getPrototypeOf, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.getPrototypeOf, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.getPrototypeOf("an");
    console.log("Object.getPrototypeOf, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Object.getPrototypeOf, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.getPrototypeOf, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.getPrototypeOf, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.getPrototypeOf(Symbol.for("name"));
    console.log("Object.getPrototypeOf, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 7, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.getPrototypeOf, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Object.getPrototypeOf(5n);
    console.log("Object.getPrototypeOf, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.getPrototypeOf, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.getPrototypeOf, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.getPrototypeOf, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.getPrototypeOf, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.getPrototypeOf, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = Object.groupBy("an", callback);
    console.log("Object.groupBy, is it an operand:", result === callback);
    const again = Object.groupBy("an", callback);
    console.log("Object.groupBy, does a second call answer the same thing:", result === again);
    console.log("Object.groupBy:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.groupBy, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.groupBy, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.groupBy, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.groupBy, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.groupBy, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.groupBy.true:", typeof result.true === "undefined", typeof result.true === "boolean", typeof result.true === "number", typeof result.true === "string", typeof result.true === "bigint", typeof result.true === "symbol", typeof result.true === "function", typeof result.true === "object", result.true === null);
    console.log("Object.groupBy.true, the class:", Array.isArray(result.true), result.true instanceof Object, result.true instanceof Array, result.true instanceof Map, result.true instanceof Set, result.true instanceof Promise, result.true instanceof Date, result.true instanceof RegExp, result.true instanceof Error, result.true instanceof ArrayBuffer, result.true instanceof Uint8Array, result.true instanceof Function, ArrayBuffer.isView(result.true));
    console.log("Object.groupBy.true, above it:", Object.getPrototypeOf(result.true) === Object.prototype, Object.getPrototypeOf(result.true) === Array.prototype, Object.getPrototypeOf(result.true) === null);
    console.log("Object.groupBy.true, its state:", Object.isFrozen(result.true), Object.isSealed(result.true), Object.isExtensible(result.true));
    console.log("Object.groupBy.true, names in it:", "length" in result.true, "size" in result.true, "then" in result.true, "next" in result.true, "constructor" in result.true, Symbol.iterator in result.true);
    console.log("Object.groupBy.true, how many keys:", Object.keys(result.true).length);
    {
      let asked = 0;
      for (const value of Object.values(result.true)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy.true, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.true)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy.true, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.true) {
        if (asked++ === 4) break;
        console.log("Object.groupBy.true, by for-in:", typeof key === "string", typeof result.true[key] === "undefined", typeof result.true[key] === "boolean", typeof result.true[key] === "number", typeof result.true[key] === "string", typeof result.true[key] === "bigint", typeof result.true[key] === "symbol", typeof result.true[key] === "function", typeof result.true[key] === "object", result.true[key] === null);
      }
    }
    console.log("Object.groupBy.true, by index:", typeof result.true[0] === "undefined", typeof result.true[0] === "boolean", typeof result.true[0] === "number", typeof result.true[0] === "string", typeof result.true[0] === "bigint", typeof result.true[0] === "symbol", typeof result.true[0] === "function", typeof result.true[0] === "object", result.true[0] === null);
    console.log("Object.groupBy.true, its length:", result.true.length === 0, result.true.length);
    {
      let asked = 0;
      for (const value of result.true) {
        if (asked++ === 4) break;
        console.log("Object.groupBy.true, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.groupBy.true, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.groupBy: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = Object.groupBy(first, callback);
    console.log("Object.groupBy, form 2, is it an operand:", result === first, result === callback);
    const again = Object.groupBy(first, callback);
    console.log("Object.groupBy, form 2, does a second call answer the same thing:", result === again);
    console.log("Object.groupBy, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.groupBy, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.groupBy, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.groupBy, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.groupBy, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.groupBy, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.groupBy, form 2.true:", typeof result.true === "undefined", typeof result.true === "boolean", typeof result.true === "number", typeof result.true === "string", typeof result.true === "bigint", typeof result.true === "symbol", typeof result.true === "function", typeof result.true === "object", result.true === null);
    console.log("Object.groupBy, form 2.true, the class:", Array.isArray(result.true), result.true instanceof Object, result.true instanceof Array, result.true instanceof Map, result.true instanceof Set, result.true instanceof Promise, result.true instanceof Date, result.true instanceof RegExp, result.true instanceof Error, result.true instanceof ArrayBuffer, result.true instanceof Uint8Array, result.true instanceof Function, ArrayBuffer.isView(result.true));
    console.log("Object.groupBy, form 2.true, above it:", Object.getPrototypeOf(result.true) === Object.prototype, Object.getPrototypeOf(result.true) === Array.prototype, Object.getPrototypeOf(result.true) === null);
    console.log("Object.groupBy, form 2.true, its state:", Object.isFrozen(result.true), Object.isSealed(result.true), Object.isExtensible(result.true));
    console.log("Object.groupBy, form 2.true, names in it:", "length" in result.true, "size" in result.true, "then" in result.true, "next" in result.true, "constructor" in result.true, Symbol.iterator in result.true);
    console.log("Object.groupBy, form 2.true, how many keys:", Object.keys(result.true).length);
    {
      let asked = 0;
      for (const value of Object.values(result.true)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2.true, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.true)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2.true, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.true) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2.true, by for-in:", typeof key === "string", typeof result.true[key] === "undefined", typeof result.true[key] === "boolean", typeof result.true[key] === "number", typeof result.true[key] === "string", typeof result.true[key] === "bigint", typeof result.true[key] === "symbol", typeof result.true[key] === "function", typeof result.true[key] === "object", result.true[key] === null);
      }
    }
    console.log("Object.groupBy, form 2.true, by index:", typeof result.true[0] === "undefined", typeof result.true[0] === "boolean", typeof result.true[0] === "number", typeof result.true[0] === "string", typeof result.true[0] === "bigint", typeof result.true[0] === "symbol", typeof result.true[0] === "function", typeof result.true[0] === "object", result.true[0] === null);
    console.log("Object.groupBy, form 2.true, its length:", result.true.length === 0, result.true.length);
    {
      let asked = 0;
      for (const value of result.true) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 2.true, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.groupBy, form 2.true, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.groupBy, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = Object.groupBy("an", callback);
    console.log("Object.groupBy, form 3, is it an operand:", result === callback);
    const again = Object.groupBy("an", callback);
    console.log("Object.groupBy, form 3, does a second call answer the same thing:", result === again);
    console.log("Object.groupBy, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.groupBy, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.groupBy, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.groupBy, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.groupBy, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.groupBy, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.groupBy, form 3.true:", typeof result.true === "undefined", typeof result.true === "boolean", typeof result.true === "number", typeof result.true === "string", typeof result.true === "bigint", typeof result.true === "symbol", typeof result.true === "function", typeof result.true === "object", result.true === null);
    console.log("Object.groupBy, form 3.true, the class:", Array.isArray(result.true), result.true instanceof Object, result.true instanceof Array, result.true instanceof Map, result.true instanceof Set, result.true instanceof Promise, result.true instanceof Date, result.true instanceof RegExp, result.true instanceof Error, result.true instanceof ArrayBuffer, result.true instanceof Uint8Array, result.true instanceof Function, ArrayBuffer.isView(result.true));
    console.log("Object.groupBy, form 3.true, above it:", Object.getPrototypeOf(result.true) === Object.prototype, Object.getPrototypeOf(result.true) === Array.prototype, Object.getPrototypeOf(result.true) === null);
    console.log("Object.groupBy, form 3.true, its state:", Object.isFrozen(result.true), Object.isSealed(result.true), Object.isExtensible(result.true));
    console.log("Object.groupBy, form 3.true, names in it:", "length" in result.true, "size" in result.true, "then" in result.true, "next" in result.true, "constructor" in result.true, Symbol.iterator in result.true);
    console.log("Object.groupBy, form 3.true, how many keys:", Object.keys(result.true).length);
    {
      let asked = 0;
      for (const value of Object.values(result.true)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3.true, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.true)) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3.true, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.true) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3.true, by for-in:", typeof key === "string", typeof result.true[key] === "undefined", typeof result.true[key] === "boolean", typeof result.true[key] === "number", typeof result.true[key] === "string", typeof result.true[key] === "bigint", typeof result.true[key] === "symbol", typeof result.true[key] === "function", typeof result.true[key] === "object", result.true[key] === null);
      }
    }
    console.log("Object.groupBy, form 3.true, by index:", typeof result.true[0] === "undefined", typeof result.true[0] === "boolean", typeof result.true[0] === "number", typeof result.true[0] === "string", typeof result.true[0] === "bigint", typeof result.true[0] === "symbol", typeof result.true[0] === "function", typeof result.true[0] === "object", result.true[0] === null);
    console.log("Object.groupBy, form 3.true, its length:", result.true.length === 0, result.true.length);
    {
      let asked = 0;
      for (const value of result.true) {
        if (asked++ === 4) break;
        console.log("Object.groupBy, form 3.true, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Object.groupBy, form 3.true, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Object.groupBy, form 3: it threw", error instanceof Error);
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
    const result = Object.hasOwn(first, "-");
    console.log("Object.hasOwn, is it an operand:", result === first);
    console.log("Object.hasOwn:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.hasOwn, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.hasOwn: it threw", error instanceof Error);
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
    const result = Object.hasOwn(first, "-");
    console.log("Object.hasOwn, form 2, is it an operand:", result === first);
    console.log("Object.hasOwn, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.hasOwn, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.hasOwn, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
