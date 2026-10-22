// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = JSON.isRawJSON(1.5);
    console.log("JSON.isRawJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.isRawJSON, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("JSON.isRawJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.isRawJSON("an");
    console.log("JSON.isRawJSON, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.isRawJSON, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("JSON.isRawJSON, form 2: it threw", error instanceof Error);
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
    const result = JSON.isRawJSON(item);
    console.log("JSON.isRawJSON, form 3, is it an operand:", result === item);
    console.log("JSON.isRawJSON, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.isRawJSON, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("JSON.isRawJSON, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.isRawJSON(1.5);
    console.log("JSON.isRawJSON, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.isRawJSON, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("JSON.isRawJSON, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', null);
    console.log("JSON.parse:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.parse, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.parse, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.parse, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.parse, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.parse, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.parse, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.parse.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("JSON.parse.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("JSON.parse.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("JSON.parse.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("JSON.parse.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("JSON.parse.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("JSON.parse.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("JSON.parse.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("JSON.parse.second, by index:", typeof result.second[0] === "undefined", typeof result.second[0] === "boolean", typeof result.second[0] === "number", typeof result.second[0] === "string", typeof result.second[0] === "bigint", typeof result.second[0] === "symbol", typeof result.second[0] === "function", typeof result.second[0] === "object", result.second[0] === null);
    console.log("JSON.parse.second, its length:", result.second.length === 0, result.second.length);
    {
      let asked = 0;
      for (const value of result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse.second, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("JSON.parse.second, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("JSON.parse: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', null);
    console.log("JSON.parse, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.parse, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.parse, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.parse, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.parse, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.parse, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.parse, form 2.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("JSON.parse, form 2.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("JSON.parse, form 2.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("JSON.parse, form 2.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("JSON.parse, form 2.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("JSON.parse, form 2.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("JSON.parse, form 2.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("JSON.parse, form 2.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("JSON.parse, form 2.second, by index:", typeof result.second[0] === "undefined", typeof result.second[0] === "boolean", typeof result.second[0] === "number", typeof result.second[0] === "string", typeof result.second[0] === "bigint", typeof result.second[0] === "symbol", typeof result.second[0] === "function", typeof result.second[0] === "object", result.second[0] === null);
    console.log("JSON.parse, form 2.second, its length:", result.second.length === 0, result.second.length);
    {
      let asked = 0;
      for (const value of result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 2.second, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("JSON.parse, form 2.second, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("JSON.parse, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', 2.5);
    console.log("JSON.parse, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.parse, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.parse, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.parse, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.parse, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.parse, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.parse, form 3.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("JSON.parse, form 3.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("JSON.parse, form 3.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("JSON.parse, form 3.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("JSON.parse, form 3.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("JSON.parse, form 3.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("JSON.parse, form 3.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("JSON.parse, form 3.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("JSON.parse, form 3.second, by index:", typeof result.second[0] === "undefined", typeof result.second[0] === "boolean", typeof result.second[0] === "number", typeof result.second[0] === "string", typeof result.second[0] === "bigint", typeof result.second[0] === "symbol", typeof result.second[0] === "function", typeof result.second[0] === "object", result.second[0] === null);
    console.log("JSON.parse, form 3.second, its length:", result.second.length === 0, result.second.length);
    {
      let asked = 0;
      for (const value of result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 3.second, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("JSON.parse, form 3.second, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("JSON.parse, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', "-");
    console.log("JSON.parse, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.parse, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.parse, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.parse, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.parse, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.parse, form 4, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.parse, form 4.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("JSON.parse, form 4.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("JSON.parse, form 4.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("JSON.parse, form 4.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("JSON.parse, form 4.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("JSON.parse, form 4.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("JSON.parse, form 4.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("JSON.parse, form 4.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("JSON.parse, form 4.second, by index:", typeof result.second[0] === "undefined", typeof result.second[0] === "boolean", typeof result.second[0] === "number", typeof result.second[0] === "string", typeof result.second[0] === "bigint", typeof result.second[0] === "symbol", typeof result.second[0] === "function", typeof result.second[0] === "object", result.second[0] === null);
    console.log("JSON.parse, form 4.second, its length:", result.second.length === 0, result.second.length);
    {
      let asked = 0;
      for (const value of result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 4.second, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("JSON.parse, form 4.second, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("JSON.parse, form 4: it threw", error instanceof Error);
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
    const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', item);
    console.log("JSON.parse, form 5, is it an operand:", result === item);
    console.log("JSON.parse, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.parse, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.parse, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.parse, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.parse, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.parse, form 5, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.parse, form 5.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("JSON.parse, form 5.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("JSON.parse, form 5.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("JSON.parse, form 5.second, the class:", Array.isArray(result.second), result.second instanceof Object, result.second instanceof Array, result.second instanceof Map, result.second instanceof Set, result.second instanceof Promise, result.second instanceof Date, result.second instanceof RegExp, result.second instanceof Error, result.second instanceof ArrayBuffer, result.second instanceof Uint8Array, result.second instanceof Function, ArrayBuffer.isView(result.second));
    console.log("JSON.parse, form 5.second, above it:", Object.getPrototypeOf(result.second) === Object.prototype, Object.getPrototypeOf(result.second) === Array.prototype, Object.getPrototypeOf(result.second) === null);
    console.log("JSON.parse, form 5.second, its state:", Object.isFrozen(result.second), Object.isSealed(result.second), Object.isExtensible(result.second));
    console.log("JSON.parse, form 5.second, names in it:", "length" in result.second, "size" in result.second, "then" in result.second, "next" in result.second, "constructor" in result.second, Symbol.iterator in result.second);
    console.log("JSON.parse, form 5.second, how many keys:", Object.keys(result.second).length);
    {
      let asked = 0;
      for (const value of Object.values(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5.second, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.second)) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5.second, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5.second, by for-in:", typeof key === "string", typeof result.second[key] === "undefined", typeof result.second[key] === "boolean", typeof result.second[key] === "number", typeof result.second[key] === "string", typeof result.second[key] === "bigint", typeof result.second[key] === "symbol", typeof result.second[key] === "function", typeof result.second[key] === "object", result.second[key] === null);
      }
    }
    console.log("JSON.parse, form 5.second, by index:", typeof result.second[0] === "undefined", typeof result.second[0] === "boolean", typeof result.second[0] === "number", typeof result.second[0] === "string", typeof result.second[0] === "bigint", typeof result.second[0] === "symbol", typeof result.second[0] === "function", typeof result.second[0] === "object", result.second[0] === null);
    console.log("JSON.parse, form 5.second, its length:", result.second.length === 0, result.second.length);
    {
      let asked = 0;
      for (const value of result.second) {
        if (asked++ === 4) break;
        console.log("JSON.parse, form 5.second, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("JSON.parse, form 5.second, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("JSON.parse, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.rawJSON("1.5");
    const again = JSON.rawJSON("1.5");
    console.log("JSON.rawJSON, does a second call answer the same thing:", result === again);
    console.log("JSON.rawJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.rawJSON, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.rawJSON, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.rawJSON, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.rawJSON, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.rawJSON, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.rawJSON, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.rawJSON, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.rawJSON, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.rawJSON.rawJSON:", typeof result.rawJSON === "undefined", typeof result.rawJSON === "boolean", typeof result.rawJSON === "number", typeof result.rawJSON === "string", typeof result.rawJSON === "bigint", typeof result.rawJSON === "symbol", typeof result.rawJSON === "function", typeof result.rawJSON === "object", result.rawJSON === null);
    console.log("JSON.rawJSON.rawJSON, the text:", result.rawJSON.length === 0, result.rawJSON === "");
  } catch (error) {
    console.log("JSON.rawJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.rawJSON("1.5");
    const again = JSON.rawJSON("1.5");
    console.log("JSON.rawJSON, form 2, does a second call answer the same thing:", result === again);
    console.log("JSON.rawJSON, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.rawJSON, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("JSON.rawJSON, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("JSON.rawJSON, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("JSON.rawJSON, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("JSON.rawJSON, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("JSON.rawJSON, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("JSON.rawJSON, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("JSON.rawJSON, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("JSON.rawJSON, form 2.rawJSON:", typeof result.rawJSON === "undefined", typeof result.rawJSON === "boolean", typeof result.rawJSON === "number", typeof result.rawJSON === "string", typeof result.rawJSON === "bigint", typeof result.rawJSON === "symbol", typeof result.rawJSON === "function", typeof result.rawJSON === "object", result.rawJSON === null);
    console.log("JSON.rawJSON, form 2.rawJSON, the text:", result.rawJSON.length === 0, result.rawJSON === "");
  } catch (error) {
    console.log("JSON.rawJSON, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.stringify(1.5, null, 3.5);
    console.log("JSON.stringify:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.stringify("an", null, 3.5);
    console.log("JSON.stringify, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 2: it threw", error instanceof Error);
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
    const result = JSON.stringify(item, null, item);
    console.log("JSON.stringify, form 3, is it an operand:", result === item, result === item);
    console.log("JSON.stringify, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.stringify(1.5, null, 3.5);
    console.log("JSON.stringify, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 4: it threw", error instanceof Error);
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
    const third = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = JSON.stringify(1.5, callback, third);
    console.log("JSON.stringify, form 5, is it an operand:", result === callback, result === third);
    console.log("JSON.stringify, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 5: it threw", error instanceof Error);
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
    const third = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = JSON.stringify("an", callback, third);
    console.log("JSON.stringify, form 6, is it an operand:", result === callback, result === third);
    console.log("JSON.stringify, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 6, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 6: it threw", error instanceof Error);
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
    const result = JSON.stringify(item, callback, item);
    console.log("JSON.stringify, form 7, is it an operand:", result === item, result === callback, result === item);
    console.log("JSON.stringify, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 7, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.stringify(1.5, 2.5, 3.5);
    console.log("JSON.stringify, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 8, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON.stringify("an", 2.5, 3.5);
    console.log("JSON.stringify, form 9:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 9, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 9: it threw", error instanceof Error);
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
    const result = JSON.stringify(item, item, item);
    console.log("JSON.stringify, form 10, is it an operand:", result === item, result === item, result === item);
    console.log("JSON.stringify, form 10:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON.stringify, form 10, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON.stringify, form 10: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = JSON[Symbol.toStringTag];
    console.log("JSON[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("JSON[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("JSON[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
