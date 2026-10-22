// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Bun.allocUnsafe(1);
    console.log("Bun.allocUnsafe:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.allocUnsafe, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.allocUnsafe, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.allocUnsafe, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.allocUnsafe, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.allocUnsafe, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.allocUnsafe, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.allocUnsafe, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.allocUnsafe: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.allocUnsafe(1);
    console.log("Bun.allocUnsafe, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.allocUnsafe, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.allocUnsafe, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.allocUnsafe, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.allocUnsafe, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.allocUnsafe, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.allocUnsafe, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.allocUnsafe, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.allocUnsafe, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.allocUnsafe, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.color(null, null);
    console.log("Bun.color:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.color: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.color(null, null);
    console.log("Bun.color, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.color, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.color(1.5, null);
    console.log("Bun.color, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.color, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.color, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.color("an", null);
    console.log("Bun.color, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.color, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = [];
    const result = Bun.concatArrayBuffers(first, 2.5, 3.5);
    console.log("Bun.concatArrayBuffers, is it an operand:", result === first);
    const again = Bun.concatArrayBuffers(first, 2.5, 3.5);
    console.log("Bun.concatArrayBuffers, does a second call answer the same thing:", result === again);
    console.log("Bun.concatArrayBuffers:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.concatArrayBuffers, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.concatArrayBuffers, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.concatArrayBuffers, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.concatArrayBuffers, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.concatArrayBuffers, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.concatArrayBuffers, how many keys:", Object.keys(result).length);
    console.log("Bun.concatArrayBuffers, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.concatArrayBuffers, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.concatArrayBuffers, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.concatArrayBuffers, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.concatArrayBuffers: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.concatArrayBuffers(null, 2.5, 3.5);
    const again = Bun.concatArrayBuffers(null, 2.5, 3.5);
    console.log("Bun.concatArrayBuffers, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.concatArrayBuffers, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.concatArrayBuffers, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.concatArrayBuffers, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.concatArrayBuffers, form 2, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("Bun.concatArrayBuffers, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.concatArrayBuffers, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.concatArrayBuffers, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.concatArrayBuffers, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.concatArrayBuffers(null, "-", 3.5);
    const again = Bun.concatArrayBuffers(null, "-", 3.5);
    console.log("Bun.concatArrayBuffers, form 3, does a second call answer the same thing:", result === again);
    console.log("Bun.concatArrayBuffers, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.concatArrayBuffers, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.concatArrayBuffers, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.concatArrayBuffers, form 3, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("Bun.concatArrayBuffers, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.concatArrayBuffers, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.concatArrayBuffers, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.concatArrayBuffers, form 3: it threw", error instanceof Error);
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
    const result = Bun.concatArrayBuffers(null, item, item);
    console.log("Bun.concatArrayBuffers, form 4, is it an operand:", result === item, result === item);
    const again = Bun.concatArrayBuffers(null, item, item);
    console.log("Bun.concatArrayBuffers, form 4, does a second call answer the same thing:", result === again);
    console.log("Bun.concatArrayBuffers, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.concatArrayBuffers, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.concatArrayBuffers, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.concatArrayBuffers, form 4, its own class:", Object.getPrototypeOf(result) === ArrayBuffer.prototype, Reflect.getPrototypeOf(result) === ArrayBuffer.prototype, result.constructor === ArrayBuffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(ArrayBuffer.prototype));
    console.log("Bun.concatArrayBuffers, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.concatArrayBuffers, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.concatArrayBuffers, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.concatArrayBuffers, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = [];
    const result = Bun.concatArrayBuffers(first, 2.5, 3.5);
    console.log("Bun.concatArrayBuffers, form 5, is it an operand:", result === first);
    const again = Bun.concatArrayBuffers(first, 2.5, 3.5);
    console.log("Bun.concatArrayBuffers, form 5, does a second call answer the same thing:", result === again);
    console.log("Bun.concatArrayBuffers, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.concatArrayBuffers, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.concatArrayBuffers, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.concatArrayBuffers, form 5, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.concatArrayBuffers, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.concatArrayBuffers, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.concatArrayBuffers, form 5, how many keys:", Object.keys(result).length);
    console.log("Bun.concatArrayBuffers, form 5, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.concatArrayBuffers, form 5, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.concatArrayBuffers, form 5, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.concatArrayBuffers, form 5, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.concatArrayBuffers, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.deepEquals(1.5, 2.5, 3.5, 4.5);
    console.log("Bun.deepEquals:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepEquals, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepEquals: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.deepEquals("an", 2.5, 3.5, 4.5);
    console.log("Bun.deepEquals, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepEquals, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepEquals, form 2: it threw", error instanceof Error);
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
    const result = Bun.deepEquals(item, item, item, item);
    console.log("Bun.deepEquals, form 3, is it an operand:", result === item, result === item, result === item, result === item);
    console.log("Bun.deepEquals, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepEquals, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepEquals, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.deepEquals(1.5, 2.5, 3.5, 4.5);
    console.log("Bun.deepEquals, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepEquals, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepEquals, form 4: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = Bun.deepMatch(first, second);
    console.log("Bun.deepMatch, is it an operand:", result === first, result === second);
    console.log("Bun.deepMatch:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepMatch, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepMatch: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = Bun.deepMatch(first, second);
    console.log("Bun.deepMatch, form 2, is it an operand:", result === first, result === second);
    console.log("Bun.deepMatch, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepMatch, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepMatch, form 2: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = Bun.deepMatch(first, second);
    console.log("Bun.deepMatch, form 3, is it an operand:", result === first, result === second);
    console.log("Bun.deepMatch, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deepMatch, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.deepMatch, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.deflateSync(first);
    console.log("Bun.deflateSync, is it an operand:", result === first);
    console.log("Bun.deflateSync:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deflateSync, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.deflateSync, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.deflateSync, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.deflateSync, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.deflateSync, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.deflateSync, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.deflateSync, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.deflateSync, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.deflateSync, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.deflateSync: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.deflateSync(first);
    console.log("Bun.deflateSync, form 2, is it an operand:", result === first);
    console.log("Bun.deflateSync, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deflateSync, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.deflateSync, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.deflateSync, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.deflateSync, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.deflateSync, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.deflateSync, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.deflateSync, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.deflateSync, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.deflateSync, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.deflateSync, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.deflateSync(first);
    console.log("Bun.deflateSync, form 3, is it an operand:", result === first);
    console.log("Bun.deflateSync, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.deflateSync, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.deflateSync, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.deflateSync, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.deflateSync, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.deflateSync, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.deflateSync, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.deflateSync, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.deflateSync, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.deflateSync, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.deflateSync, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.deflateSync, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.enableANSIColors;
    console.log("Bun.enableANSIColors, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.enableANSIColors, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.enableANSIColors, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.escapeHTML("an");
    console.log("Bun.escapeHTML:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.escapeHTML, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.escapeHTML: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.escapeHTML("an");
    console.log("Bun.escapeHTML, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.escapeHTML, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.escapeHTML, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.fileURLToPath("file:///tmp/a.js");
    console.log("Bun.fileURLToPath:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.fileURLToPath: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.fileURLToPath("file:///tmp/a.js");
    console.log("Bun.fileURLToPath, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.fileURLToPath, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.gzipSync(first);
    console.log("Bun.gzipSync, is it an operand:", result === first);
    console.log("Bun.gzipSync:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.gzipSync, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.gzipSync, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.gzipSync, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.gzipSync, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.gzipSync, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.gzipSync, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.gzipSync, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.gzipSync, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.gzipSync, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.gzipSync: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.gzipSync(first);
    console.log("Bun.gzipSync, form 2, is it an operand:", result === first);
    console.log("Bun.gzipSync, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.gzipSync, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.gzipSync, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.gzipSync, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.gzipSync, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.gzipSync, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.gzipSync, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.gzipSync, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.gzipSync, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.gzipSync, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.gzipSync, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.gzipSync(first);
    console.log("Bun.gzipSync, form 3, is it an operand:", result === first);
    console.log("Bun.gzipSync, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.gzipSync, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.gzipSync, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.gzipSync, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.gzipSync, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.gzipSync, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.gzipSync, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.gzipSync, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.gzipSync, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.gzipSync, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.gzipSync, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.gzipSync, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash(first, 2.5);
    console.log("Bun.hash, is it an operand:", result === first);
    console.log("Bun.hash:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
