// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = performance.now();
    console.log("performance.now:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("performance.now: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = performance.now();
    console.log("performance.now, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("performance.now, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.clearMarks(1.5);
    console.log("Performance.prototype.clearMarks, is it an operand:", result === subject);
    console.log("Performance.prototype.clearMarks:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearMarks: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.clearMarks("an");
    console.log("Performance.prototype.clearMarks, form 2, is it an operand:", result === subject);
    console.log("Performance.prototype.clearMarks, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearMarks, form 2: it threw", error instanceof Error);
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
    const subject = performance;
    const result = subject.clearMarks(item);
    console.log("Performance.prototype.clearMarks, form 3, is it an operand:", result === subject, result === item);
    console.log("Performance.prototype.clearMarks, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearMarks, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.clearMeasures(1.5);
    console.log("Performance.prototype.clearMeasures, is it an operand:", result === subject);
    console.log("Performance.prototype.clearMeasures:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearMeasures: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.clearMeasures("an");
    console.log("Performance.prototype.clearMeasures, form 2, is it an operand:", result === subject);
    console.log("Performance.prototype.clearMeasures, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearMeasures, form 2: it threw", error instanceof Error);
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
    const subject = performance;
    const result = subject.clearMeasures(item);
    console.log("Performance.prototype.clearMeasures, form 3, is it an operand:", result === subject, result === item);
    console.log("Performance.prototype.clearMeasures, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearMeasures, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.clearResourceTimings();
    console.log("Performance.prototype.clearResourceTimings, is it an operand:", result === subject);
    console.log("Performance.prototype.clearResourceTimings:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.clearResourceTimings: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.getEntries();
    console.log("Performance.prototype.getEntries, is it an operand:", result === subject);
    const again = subject.getEntries();
    console.log("Performance.prototype.getEntries, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntries:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntries, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntries, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntries, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntries, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntries, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntries, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntries, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntries: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.getEntriesByName(1.5, 2.5);
    console.log("Performance.prototype.getEntriesByName, is it an operand:", result === subject);
    const again = subject.getEntriesByName(1.5, 2.5);
    console.log("Performance.prototype.getEntriesByName, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntriesByName:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntriesByName, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntriesByName, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntriesByName, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntriesByName, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntriesByName, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntriesByName, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntriesByName, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntriesByName: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.getEntriesByName("an", 2.5);
    console.log("Performance.prototype.getEntriesByName, form 2, is it an operand:", result === subject);
    const again = subject.getEntriesByName("an", 2.5);
    console.log("Performance.prototype.getEntriesByName, form 2, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntriesByName, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntriesByName, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntriesByName, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntriesByName, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntriesByName, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntriesByName, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntriesByName, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntriesByName, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntriesByName, form 2: it threw", error instanceof Error);
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
    const subject = performance;
    const result = subject.getEntriesByName(item, item);
    console.log("Performance.prototype.getEntriesByName, form 3, is it an operand:", result === subject, result === item, result === item);
    const again = subject.getEntriesByName(item, item);
    console.log("Performance.prototype.getEntriesByName, form 3, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntriesByName, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntriesByName, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntriesByName, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntriesByName, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntriesByName, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntriesByName, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntriesByName, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntriesByName, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntriesByName, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.getEntriesByType(1.5);
    console.log("Performance.prototype.getEntriesByType, is it an operand:", result === subject);
    const again = subject.getEntriesByType(1.5);
    console.log("Performance.prototype.getEntriesByType, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntriesByType:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntriesByType, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntriesByType, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntriesByType, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntriesByType, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntriesByType, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntriesByType, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntriesByType, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntriesByType: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.getEntriesByType("an");
    console.log("Performance.prototype.getEntriesByType, form 2, is it an operand:", result === subject);
    const again = subject.getEntriesByType("an");
    console.log("Performance.prototype.getEntriesByType, form 2, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntriesByType, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntriesByType, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntriesByType, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntriesByType, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntriesByType, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntriesByType, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntriesByType, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntriesByType, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntriesByType, form 2: it threw", error instanceof Error);
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
    const subject = performance;
    const result = subject.getEntriesByType(item);
    console.log("Performance.prototype.getEntriesByType, form 3, is it an operand:", result === subject, result === item);
    const again = subject.getEntriesByType(item);
    console.log("Performance.prototype.getEntriesByType, form 3, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.getEntriesByType, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.getEntriesByType, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.getEntriesByType, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.getEntriesByType, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.getEntriesByType, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Performance.prototype.getEntriesByType, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.getEntriesByType, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Performance.prototype.getEntriesByType, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Performance.prototype.getEntriesByType, form 3: it threw", error instanceof Error);
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
    const subject = performance;
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.mark(1.5, second);
    console.log("Performance.prototype.mark, is it an operand:", result === subject, result === second);
    console.log("Performance.prototype.mark:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.mark, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.mark, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.mark, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.mark, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Performance.prototype.mark: it threw", error instanceof Error);
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
    const subject = performance;
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.mark("an", second);
    console.log("Performance.prototype.mark, form 2, is it an operand:", result === subject, result === second);
    console.log("Performance.prototype.mark, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.mark, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.mark, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.mark, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.mark, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Performance.prototype.mark, form 2: it threw", error instanceof Error);
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
    const subject = performance;
    const result = subject.mark(item, item);
    console.log("Performance.prototype.mark, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Performance.prototype.mark, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.mark, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.mark, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.mark, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.mark, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Performance.prototype.mark, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.markResourceTiming();
    console.log("Performance.prototype.markResourceTiming, is it an operand:", result === subject);
    console.log("Performance.prototype.markResourceTiming:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.markResourceTiming: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.setResourceTimingBufferSize(1.5);
    console.log("Performance.prototype.setResourceTimingBufferSize, is it an operand:", result === subject);
    console.log("Performance.prototype.setResourceTimingBufferSize:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.setResourceTimingBufferSize: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.setResourceTimingBufferSize("an");
    console.log("Performance.prototype.setResourceTimingBufferSize, form 2, is it an operand:", result === subject);
    console.log("Performance.prototype.setResourceTimingBufferSize, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.setResourceTimingBufferSize, form 2: it threw", error instanceof Error);
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
    const subject = performance;
    const result = subject.setResourceTimingBufferSize(item);
    console.log("Performance.prototype.setResourceTimingBufferSize, form 3, is it an operand:", result === subject, result === item);
    console.log("Performance.prototype.setResourceTimingBufferSize, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.setResourceTimingBufferSize, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.timeOrigin;
    console.log("Performance.prototype.timeOrigin, get, is it an operand:", result === subject);
    console.log("Performance.prototype.timeOrigin, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype.timeOrigin, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.timing;
    console.log("Performance.prototype.timing, get, is it an operand:", result === subject);
    console.log("Performance.prototype.timing, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.timing, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.timing, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.timing, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.timing, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Performance.prototype.timing, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject.toJSON();
    console.log("Performance.prototype.toJSON, is it an operand:", result === subject);
    const again = subject.toJSON();
    console.log("Performance.prototype.toJSON, does a second call answer the same thing:", result === again);
    console.log("Performance.prototype.toJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Performance.prototype.toJSON, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Performance.prototype.toJSON, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Performance.prototype.toJSON, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Performance.prototype.toJSON, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.toJSON, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.toJSON, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Performance.prototype.toJSON, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Performance.prototype.toJSON.timeOrigin:", typeof result.timeOrigin === "undefined", typeof result.timeOrigin === "boolean", typeof result.timeOrigin === "number", typeof result.timeOrigin === "string", typeof result.timeOrigin === "bigint", typeof result.timeOrigin === "symbol", typeof result.timeOrigin === "function", typeof result.timeOrigin === "object", result.timeOrigin === null);
    console.log("Performance.prototype.toJSON.timing:", typeof result.timing === "undefined", typeof result.timing === "boolean", typeof result.timing === "number", typeof result.timing === "string", typeof result.timing === "bigint", typeof result.timing === "symbol", typeof result.timing === "function", typeof result.timing === "object", result.timing === null);
    console.log("Performance.prototype.toJSON.timing, the class:", Array.isArray(result.timing), result.timing instanceof Object, result.timing instanceof Array, result.timing instanceof Map, result.timing instanceof Set, result.timing instanceof Promise, result.timing instanceof Date, result.timing instanceof RegExp, result.timing instanceof Error, result.timing instanceof ArrayBuffer, result.timing instanceof Uint8Array, result.timing instanceof Function, ArrayBuffer.isView(result.timing));
    console.log("Performance.prototype.toJSON.timing, above it:", Object.getPrototypeOf(result.timing) === Object.prototype, Object.getPrototypeOf(result.timing) === Array.prototype, Object.getPrototypeOf(result.timing) === null);
    console.log("Performance.prototype.toJSON.timing, its state:", Object.isFrozen(result.timing), Object.isSealed(result.timing), Object.isExtensible(result.timing));
    console.log("Performance.prototype.toJSON.timing, names in it:", "length" in result.timing, "size" in result.timing, "then" in result.timing, "next" in result.timing, "constructor" in result.timing, Symbol.iterator in result.timing);
  } catch (error) {
    console.log("Performance.prototype.toJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = performance;
    const result = subject[Symbol.toStringTag];
    console.log("Performance.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Performance.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Performance.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
