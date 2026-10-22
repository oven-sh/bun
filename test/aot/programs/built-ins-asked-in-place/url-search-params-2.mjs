// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.has(1.5, 2.5);
    console.log("URLSearchParams.prototype.has, form 3, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.has, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.has, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URLSearchParams.prototype.has, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.has("an", 2.5);
    console.log("URLSearchParams.prototype.has, form 4, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.has, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.has, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URLSearchParams.prototype.has, form 4: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.has(item, item);
    console.log("URLSearchParams.prototype.has, form 5, is it an operand:", result === subject, result === item, result === item);
    console.log("URLSearchParams.prototype.has, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.has, form 5, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URLSearchParams.prototype.has, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.has(1.5, 2.5);
    console.log("URLSearchParams.prototype.has, form 6, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.has, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.has, form 6, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URLSearchParams.prototype.has, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.keys();
    console.log("URLSearchParams.prototype.keys, is it an operand:", result === subject);
    const again = subject.keys();
    console.log("URLSearchParams.prototype.keys, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.keys:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.keys, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.keys, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.keys, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.keys, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.keys, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.keys, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.keys, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.keys: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.keys();
    console.log("URLSearchParams.prototype.keys, form 2, is it an operand:", result === subject);
    const again = subject.keys();
    console.log("URLSearchParams.prototype.keys, form 2, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.keys, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.keys, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.keys, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.keys, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.keys, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.keys, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.keys, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.keys, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.keys, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.length;
    console.log("URLSearchParams.prototype.length, get, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("URLSearchParams.prototype.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("URLSearchParams.prototype.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.length;
    console.log("URLSearchParams.prototype.length, get, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.length, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("URLSearchParams.prototype.length, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.length, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("URLSearchParams.prototype.length, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.set("an", "-");
    console.log("URLSearchParams.prototype.set, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.set:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.set: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.set("an", "-");
    console.log("URLSearchParams.prototype.set, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.set, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.set, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.set(1.5, 2.5);
    console.log("URLSearchParams.prototype.set, form 3, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.set, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.set, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.set("an", 2.5);
    console.log("URLSearchParams.prototype.set, form 4, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.set, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.set, form 4: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.set(item, item);
    console.log("URLSearchParams.prototype.set, form 5, is it an operand:", result === subject, result === item, result === item);
    console.log("URLSearchParams.prototype.set, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.set, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.set(1.5, 2.5);
    console.log("URLSearchParams.prototype.set, form 6, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.set, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.set, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.size;
    console.log("URLSearchParams.prototype.size, get, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.size, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("URLSearchParams.prototype.size, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.size, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("URLSearchParams.prototype.size, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.size;
    console.log("URLSearchParams.prototype.size, get, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.size, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("URLSearchParams.prototype.size, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.size, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("URLSearchParams.prototype.size, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.sort();
    console.log("URLSearchParams.prototype.sort, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.sort:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.sort: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.sort();
    console.log("URLSearchParams.prototype.sort, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.sort, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.sort, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.toJSON();
    console.log("URLSearchParams.prototype.toJSON, is it an operand:", result === subject);
    const again = subject.toJSON();
    console.log("URLSearchParams.prototype.toJSON, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.toJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.toJSON, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.toJSON, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.toJSON, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.toJSON, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.toJSON, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("URLSearchParams.prototype.toJSON.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("URLSearchParams.prototype.toJSON.first, the class:", Array.isArray(result.first), result.first instanceof Object, result.first instanceof Array, result.first instanceof Map, result.first instanceof Set, result.first instanceof Promise, result.first instanceof Date, result.first instanceof RegExp, result.first instanceof Error, result.first instanceof ArrayBuffer, result.first instanceof Uint8Array, result.first instanceof Function, ArrayBuffer.isView(result.first));
    console.log("URLSearchParams.prototype.toJSON.first, above it:", Object.getPrototypeOf(result.first) === Object.prototype, Object.getPrototypeOf(result.first) === Array.prototype, Object.getPrototypeOf(result.first) === null);
    console.log("URLSearchParams.prototype.toJSON.first, its state:", Object.isFrozen(result.first), Object.isSealed(result.first), Object.isExtensible(result.first));
    console.log("URLSearchParams.prototype.toJSON.first, names in it:", "length" in result.first, "size" in result.first, "then" in result.first, "next" in result.first, "constructor" in result.first, Symbol.iterator in result.first);
    console.log("URLSearchParams.prototype.toJSON.first, how many keys:", Object.keys(result.first).length);
    {
      let asked = 0;
      for (const value of Object.values(result.first)) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON.first, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.first)) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON.first, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.first) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON.first, by for-in:", typeof key === "string", typeof result.first[key] === "undefined", typeof result.first[key] === "boolean", typeof result.first[key] === "number", typeof result.first[key] === "string", typeof result.first[key] === "bigint", typeof result.first[key] === "symbol", typeof result.first[key] === "function", typeof result.first[key] === "object", result.first[key] === null);
      }
    }
    console.log("URLSearchParams.prototype.toJSON.first, by index:", typeof result.first[0] === "undefined", typeof result.first[0] === "boolean", typeof result.first[0] === "number", typeof result.first[0] === "string", typeof result.first[0] === "bigint", typeof result.first[0] === "symbol", typeof result.first[0] === "function", typeof result.first[0] === "object", result.first[0] === null);
    console.log("URLSearchParams.prototype.toJSON.first, its length:", result.first.length === 0, result.first.length);
    {
      let asked = 0;
      for (const value of result.first) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.toJSON.first, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.toJSON.first, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("URLSearchParams.prototype.toJSON.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("URLSearchParams.prototype.toJSON.second, the text:", result.second.length === 0, result.second === "");
  } catch (error) {
    console.log("URLSearchParams.prototype.toJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.toJSON();
    console.log("URLSearchParams.prototype.toJSON, form 2, is it an operand:", result === subject);
    const again = subject.toJSON();
    console.log("URLSearchParams.prototype.toJSON, form 2, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.toJSON, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.toJSON, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.toJSON, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.toJSON, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.toJSON, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.toJSON, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("URLSearchParams.prototype.toJSON, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.toString();
    console.log("URLSearchParams.prototype.toString, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URLSearchParams.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.toString();
    console.log("URLSearchParams.prototype.toString, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.toString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.toString, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URLSearchParams.prototype.toString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.values();
    console.log("URLSearchParams.prototype.values, is it an operand:", result === subject);
    const again = subject.values();
    console.log("URLSearchParams.prototype.values, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.values:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.values, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.values, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.values, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.values, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.values, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.values: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.values();
    console.log("URLSearchParams.prototype.values, form 2, is it an operand:", result === subject);
    const again = subject.values();
    console.log("URLSearchParams.prototype.values, form 2, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.values, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.values, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.values, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.values, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.values, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.values, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.values, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.values, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.values, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject[Symbol.toStringTag];
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject[Symbol.toStringTag];
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URLSearchParams.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
