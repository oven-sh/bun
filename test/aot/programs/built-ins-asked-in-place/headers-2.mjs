// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.has("an");
    console.log("Headers.prototype.has, is it an operand:", result === subject);
    console.log("Headers.prototype.has:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.has, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Headers.prototype.has: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.has("an");
    console.log("Headers.prototype.has, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.has, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.has, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Headers.prototype.has, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.has(1.5);
    console.log("Headers.prototype.has, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.has, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.has, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Headers.prototype.has, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.has(1.5);
    console.log("Headers.prototype.has, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.has, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.has, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Headers.prototype.has, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.keys();
    console.log("Headers.prototype.keys, is it an operand:", result === subject);
    const again = subject.keys();
    console.log("Headers.prototype.keys, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.keys:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.keys, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.keys, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.keys, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.keys, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.keys, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.keys, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.keys, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.keys: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.keys();
    console.log("Headers.prototype.keys, form 2, is it an operand:", result === subject);
    const again = subject.keys();
    console.log("Headers.prototype.keys, form 2, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.keys, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.keys, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.keys, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.keys, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.keys, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.keys, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.keys, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.keys, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.keys, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.set("an", "-");
    console.log("Headers.prototype.set, is it an operand:", result === subject);
    console.log("Headers.prototype.set:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.set: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.set("an", "-");
    console.log("Headers.prototype.set, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.set, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.set, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.set(1.5, 2.5);
    console.log("Headers.prototype.set, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.set, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.set, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.set("an", 2.5);
    console.log("Headers.prototype.set, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.set, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.set, form 4: it threw", error instanceof Error);
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
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.set(1.5, item);
    console.log("Headers.prototype.set, form 5, is it an operand:", result === subject, result === item);
    console.log("Headers.prototype.set, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.set, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.set(1.5, 2.5);
    console.log("Headers.prototype.set, form 6, is it an operand:", result === subject);
    console.log("Headers.prototype.set, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.set, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.toJSON();
    console.log("Headers.prototype.toJSON, is it an operand:", result === subject);
    console.log("Headers.prototype.toJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.toJSON, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.toJSON, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.toJSON, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.toJSON, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.toJSON, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.toJSON, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.toJSON, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.toJSON, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Headers.prototype.toJSON.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Headers.prototype.toJSON.first, the text:", result.first.length === 0, result.first === "");
    console.log("Headers.prototype.toJSON.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Headers.prototype.toJSON.second, the text:", result.second.length === 0, result.second === "");
  } catch (error) {
    console.log("Headers.prototype.toJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.toJSON();
    console.log("Headers.prototype.toJSON, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.toJSON, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.toJSON, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.toJSON, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.toJSON, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.toJSON, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.toJSON, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Headers.prototype.toJSON, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.values();
    console.log("Headers.prototype.values, is it an operand:", result === subject);
    const again = subject.values();
    console.log("Headers.prototype.values, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.values:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.values, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.values, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.values, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.values, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.values, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.values: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.values();
    console.log("Headers.prototype.values, form 2, is it an operand:", result === subject);
    const again = subject.values();
    console.log("Headers.prototype.values, form 2, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.values, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.values, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.values, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.values, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.values, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.values, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.values, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.values, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.values, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject[Symbol.toStringTag];
    console.log("Headers.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Headers.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Headers.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject[Symbol.toStringTag];
    console.log("Headers.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Headers.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
