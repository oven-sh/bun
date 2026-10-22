// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Bun.JSONL.parse("an");
    const again = Bun.JSONL.parse("an");
    console.log("Bun.JSONL.parse, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parse:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parse, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parse, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parse, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parse, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parse, how many keys:", Object.keys(result).length);
    console.log("Bun.JSONL.parse, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.JSONL.parse, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parse, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.JSONL.parse: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.JSONL.parse("an");
    const again = Bun.JSONL.parse("an");
    console.log("Bun.JSONL.parse, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parse, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parse, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parse, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parse, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parse, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parse, form 2, how many keys:", Object.keys(result).length);
    console.log("Bun.JSONL.parse, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.JSONL.parse, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parse, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.JSONL.parse, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array(0);
    const result = Bun.JSONL.parse(first);
    console.log("Bun.JSONL.parse, form 3, is it an operand:", result === first);
    const again = Bun.JSONL.parse(first);
    console.log("Bun.JSONL.parse, form 3, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parse, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parse, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parse, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parse, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parse, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parse, form 3, how many keys:", Object.keys(result).length);
    console.log("Bun.JSONL.parse, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.JSONL.parse, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parse, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.JSONL.parse, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.JSONL.parse(1.5);
    const again = Bun.JSONL.parse(1.5);
    console.log("Bun.JSONL.parse, form 4, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parse, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parse, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parse, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parse, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parse, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parse, form 4, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, form 4, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, form 4, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, form 4, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parse, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.JSONL.parse, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parse, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parse, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.JSONL.parse, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array([1, 2, 3]);
    const result = Bun.JSONL.parseChunk(first, 2.5, 3.5);
    console.log("Bun.JSONL.parseChunk, is it an operand:", result === first);
    const again = Bun.JSONL.parseChunk(first, 2.5, 3.5);
    console.log("Bun.JSONL.parseChunk, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk.values, how many keys:", Object.keys(result.values).length);
    console.log("Bun.JSONL.parseChunk.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
    console.log("Bun.JSONL.parseChunk.error, the class:", Array.isArray(result.error), result.error instanceof Object, result.error instanceof Array, result.error instanceof Map, result.error instanceof Set, result.error instanceof Promise, result.error instanceof Date, result.error instanceof RegExp, result.error instanceof Error, result.error instanceof ArrayBuffer, result.error instanceof Uint8Array, result.error instanceof Function, ArrayBuffer.isView(result.error));
    console.log("Bun.JSONL.parseChunk.error, above it:", Object.getPrototypeOf(result.error) === Object.prototype, Object.getPrototypeOf(result.error) === Array.prototype, Object.getPrototypeOf(result.error) === null);
    console.log("Bun.JSONL.parseChunk.error, its own class:", Object.getPrototypeOf(result.error) === SyntaxError.prototype, Reflect.getPrototypeOf(result.error) === SyntaxError.prototype, result.error.constructor === SyntaxError, Object.getPrototypeOf(result.error) === Object.getPrototypeOf(SyntaxError.prototype));
    console.log("Bun.JSONL.parseChunk.error, its state:", Object.isFrozen(result.error), Object.isSealed(result.error), Object.isExtensible(result.error));
    console.log("Bun.JSONL.parseChunk.error, names in it:", "length" in result.error, "size" in result.error, "then" in result.error, "next" in result.error, "constructor" in result.error, Symbol.iterator in result.error);
    console.log("Bun.JSONL.parseChunk.error, how many keys:", Object.keys(result.error).length);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array([1, 2, 3]);
    const result = Bun.JSONL.parseChunk(first, "-", 3.5);
    console.log("Bun.JSONL.parseChunk, form 2, is it an operand:", result === first);
    const again = Bun.JSONL.parseChunk(first, "-", 3.5);
    console.log("Bun.JSONL.parseChunk, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 2.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk, form 2.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk, form 2.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk, form 2.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk, form 2.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk, form 2.values, how many keys:", Object.keys(result.values).length);
    console.log("Bun.JSONL.parseChunk, form 2.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk, form 2.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 2.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk, form 2.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 2.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk, form 2.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk, form 2.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk, form 2.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk, form 2.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
    console.log("Bun.JSONL.parseChunk, form 2.error, the class:", Array.isArray(result.error), result.error instanceof Object, result.error instanceof Array, result.error instanceof Map, result.error instanceof Set, result.error instanceof Promise, result.error instanceof Date, result.error instanceof RegExp, result.error instanceof Error, result.error instanceof ArrayBuffer, result.error instanceof Uint8Array, result.error instanceof Function, ArrayBuffer.isView(result.error));
    console.log("Bun.JSONL.parseChunk, form 2.error, above it:", Object.getPrototypeOf(result.error) === Object.prototype, Object.getPrototypeOf(result.error) === Array.prototype, Object.getPrototypeOf(result.error) === null);
    console.log("Bun.JSONL.parseChunk, form 2.error, its own class:", Object.getPrototypeOf(result.error) === SyntaxError.prototype, Reflect.getPrototypeOf(result.error) === SyntaxError.prototype, result.error.constructor === SyntaxError, Object.getPrototypeOf(result.error) === Object.getPrototypeOf(SyntaxError.prototype));
    console.log("Bun.JSONL.parseChunk, form 2.error, its state:", Object.isFrozen(result.error), Object.isSealed(result.error), Object.isExtensible(result.error));
    console.log("Bun.JSONL.parseChunk, form 2.error, names in it:", "length" in result.error, "size" in result.error, "then" in result.error, "next" in result.error, "constructor" in result.error, Symbol.iterator in result.error);
    console.log("Bun.JSONL.parseChunk, form 2.error, how many keys:", Object.keys(result.error).length);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk, form 2: it threw", error instanceof Error);
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
    const first = new Uint8Array([1, 2, 3]);
    const result = Bun.JSONL.parseChunk(first, item, item);
    console.log("Bun.JSONL.parseChunk, form 3, is it an operand:", result === first, result === item, result === item);
    const again = Bun.JSONL.parseChunk(first, item, item);
    console.log("Bun.JSONL.parseChunk, form 3, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 3.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk, form 3.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk, form 3.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk, form 3.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk, form 3.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk, form 3.values, how many keys:", Object.keys(result.values).length);
    console.log("Bun.JSONL.parseChunk, form 3.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk, form 3.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 3.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk, form 3.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 3.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk, form 3.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk, form 3.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk, form 3.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk, form 3.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
    console.log("Bun.JSONL.parseChunk, form 3.error, the class:", Array.isArray(result.error), result.error instanceof Object, result.error instanceof Array, result.error instanceof Map, result.error instanceof Set, result.error instanceof Promise, result.error instanceof Date, result.error instanceof RegExp, result.error instanceof Error, result.error instanceof ArrayBuffer, result.error instanceof Uint8Array, result.error instanceof Function, ArrayBuffer.isView(result.error));
    console.log("Bun.JSONL.parseChunk, form 3.error, above it:", Object.getPrototypeOf(result.error) === Object.prototype, Object.getPrototypeOf(result.error) === Array.prototype, Object.getPrototypeOf(result.error) === null);
    console.log("Bun.JSONL.parseChunk, form 3.error, its own class:", Object.getPrototypeOf(result.error) === SyntaxError.prototype, Reflect.getPrototypeOf(result.error) === SyntaxError.prototype, result.error.constructor === SyntaxError, Object.getPrototypeOf(result.error) === Object.getPrototypeOf(SyntaxError.prototype));
    console.log("Bun.JSONL.parseChunk, form 3.error, its state:", Object.isFrozen(result.error), Object.isSealed(result.error), Object.isExtensible(result.error));
    console.log("Bun.JSONL.parseChunk, form 3.error, names in it:", "length" in result.error, "size" in result.error, "then" in result.error, "next" in result.error, "constructor" in result.error, Symbol.iterator in result.error);
    console.log("Bun.JSONL.parseChunk, form 3.error, how many keys:", Object.keys(result.error).length);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array(0);
    const result = Bun.JSONL.parseChunk(first, 2.5, 3.5);
    console.log("Bun.JSONL.parseChunk, form 4, is it an operand:", result === first);
    const again = Bun.JSONL.parseChunk(first, 2.5, 3.5);
    console.log("Bun.JSONL.parseChunk, form 4, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, form 4, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 4, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 4, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 4, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 4.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk, form 4.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk, form 4.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk, form 4.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk, form 4.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk, form 4.values, how many keys:", Object.keys(result.values).length);
    console.log("Bun.JSONL.parseChunk, form 4.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk, form 4.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 4.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk, form 4.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 4.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk, form 4.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk, form 4.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk, form 4.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk, form 4.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.JSONL.parseChunk(1.5, 2.5, 3.5);
    const again = Bun.JSONL.parseChunk(1.5, 2.5, 3.5);
    console.log("Bun.JSONL.parseChunk, form 5, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, form 5, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 5.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk, form 5.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk, form 5.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk, form 5.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk, form 5.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk, form 5.values, how many keys:", Object.keys(result.values).length);
    {
      let asked = 0;
      for (const value of Object.values(result.values)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5.values, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.values)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5.values, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5.values, by for-in:", typeof key === "string", typeof result.values[key] === "undefined", typeof result.values[key] === "boolean", typeof result.values[key] === "number", typeof result.values[key] === "string", typeof result.values[key] === "bigint", typeof result.values[key] === "symbol", typeof result.values[key] === "function", typeof result.values[key] === "object", result.values[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 5.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk, form 5.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 5.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk, form 5.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 5.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk, form 5.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk, form 5.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk, form 5.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk, form 5.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.JSONL.parseChunk("an", 2.5, 3.5);
    const again = Bun.JSONL.parseChunk("an", 2.5, 3.5);
    console.log("Bun.JSONL.parseChunk, form 6, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 6.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk, form 6.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk, form 6.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk, form 6.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk, form 6.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk, form 6.values, how many keys:", Object.keys(result.values).length);
    console.log("Bun.JSONL.parseChunk, form 6.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk, form 6.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 6.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk, form 6.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 6.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk, form 6.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk, form 6.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk, form 6.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk, form 6.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk, form 6: it threw", error instanceof Error);
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
    const result = Bun.JSONL.parseChunk(item, item, item);
    console.log("Bun.JSONL.parseChunk, form 7, is it an operand:", result === item, result === item, result === item);
    const again = Bun.JSONL.parseChunk(item, item, item);
    console.log("Bun.JSONL.parseChunk, form 7, does a second call answer the same thing:", result === again);
    console.log("Bun.JSONL.parseChunk, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.JSONL.parseChunk, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.JSONL.parseChunk, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.JSONL.parseChunk, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.JSONL.parseChunk, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.JSONL.parseChunk, form 7, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 7, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 7, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 7, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 7.values:", typeof result.values === "undefined", typeof result.values === "boolean", typeof result.values === "number", typeof result.values === "string", typeof result.values === "bigint", typeof result.values === "symbol", typeof result.values === "function", typeof result.values === "object", result.values === null);
    console.log("Bun.JSONL.parseChunk, form 7.values, the class:", Array.isArray(result.values), result.values instanceof Object, result.values instanceof Array, result.values instanceof Map, result.values instanceof Set, result.values instanceof Promise, result.values instanceof Date, result.values instanceof RegExp, result.values instanceof Error, result.values instanceof ArrayBuffer, result.values instanceof Uint8Array, result.values instanceof Function, ArrayBuffer.isView(result.values));
    console.log("Bun.JSONL.parseChunk, form 7.values, above it:", Object.getPrototypeOf(result.values) === Object.prototype, Object.getPrototypeOf(result.values) === Array.prototype, Object.getPrototypeOf(result.values) === null);
    console.log("Bun.JSONL.parseChunk, form 7.values, its state:", Object.isFrozen(result.values), Object.isSealed(result.values), Object.isExtensible(result.values));
    console.log("Bun.JSONL.parseChunk, form 7.values, names in it:", "length" in result.values, "size" in result.values, "then" in result.values, "next" in result.values, "constructor" in result.values, Symbol.iterator in result.values);
    console.log("Bun.JSONL.parseChunk, form 7.values, how many keys:", Object.keys(result.values).length);
    console.log("Bun.JSONL.parseChunk, form 7.values, by index:", typeof result.values[0] === "undefined", typeof result.values[0] === "boolean", typeof result.values[0] === "number", typeof result.values[0] === "string", typeof result.values[0] === "bigint", typeof result.values[0] === "symbol", typeof result.values[0] === "function", typeof result.values[0] === "object", result.values[0] === null);
    console.log("Bun.JSONL.parseChunk, form 7.values, its length:", result.values.length === 0, result.values.length);
    {
      let asked = 0;
      for (const value of result.values) {
        if (asked++ === 4) break;
        console.log("Bun.JSONL.parseChunk, form 7.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.JSONL.parseChunk, form 7.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("Bun.JSONL.parseChunk, form 7.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Bun.JSONL.parseChunk, form 7.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Bun.JSONL.parseChunk, form 7.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("Bun.JSONL.parseChunk, form 7.done, the boolean:", result.done === true, result.done === false, !result.done);
    console.log("Bun.JSONL.parseChunk, form 7.error:", typeof result.error === "undefined", typeof result.error === "boolean", typeof result.error === "number", typeof result.error === "string", typeof result.error === "bigint", typeof result.error === "symbol", typeof result.error === "function", typeof result.error === "object", result.error === null);
    console.log("Bun.JSONL.parseChunk, form 7.error, the class:", Array.isArray(result.error), result.error instanceof Object, result.error instanceof Array, result.error instanceof Map, result.error instanceof Set, result.error instanceof Promise, result.error instanceof Date, result.error instanceof RegExp, result.error instanceof Error, result.error instanceof ArrayBuffer, result.error instanceof Uint8Array, result.error instanceof Function, ArrayBuffer.isView(result.error));
    console.log("Bun.JSONL.parseChunk, form 7.error, above it:", Object.getPrototypeOf(result.error) === Object.prototype, Object.getPrototypeOf(result.error) === Array.prototype, Object.getPrototypeOf(result.error) === null);
    console.log("Bun.JSONL.parseChunk, form 7.error, its own class:", Object.getPrototypeOf(result.error) === SyntaxError.prototype, Reflect.getPrototypeOf(result.error) === SyntaxError.prototype, result.error.constructor === SyntaxError, Object.getPrototypeOf(result.error) === Object.getPrototypeOf(SyntaxError.prototype));
    console.log("Bun.JSONL.parseChunk, form 7.error, its state:", Object.isFrozen(result.error), Object.isSealed(result.error), Object.isExtensible(result.error));
    console.log("Bun.JSONL.parseChunk, form 7.error, names in it:", "length" in result.error, "size" in result.error, "then" in result.error, "next" in result.error, "constructor" in result.error, Symbol.iterator in result.error);
    console.log("Bun.JSONL.parseChunk, form 7.error, how many keys:", Object.keys(result.error).length);
  } catch (error) {
    console.log("Bun.JSONL.parseChunk, form 7: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
