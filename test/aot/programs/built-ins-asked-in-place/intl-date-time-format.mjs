// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Intl.DateTimeFormat.length;
    console.log("Intl.DateTimeFormat.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Intl.DateTimeFormat.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.DateTimeFormat.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.DateTimeFormat.name;
    console.log("Intl.DateTimeFormat.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.DateTimeFormat.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.DateTimeFormat.supportedLocalesOf(1.5, 2.5);
    const again = Intl.DateTimeFormat.supportedLocalesOf(1.5, 2.5);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, does a second call answer the same thing:", result === again);
    console.log("Intl.DateTimeFormat.supportedLocalesOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.supportedLocalesOf, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.DateTimeFormat.supportedLocalesOf, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.DateTimeFormat.supportedLocalesOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.DateTimeFormat.supportedLocalesOf("an", 2.5);
    const again = Intl.DateTimeFormat.supportedLocalesOf("an", 2.5);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, does a second call answer the same thing:", result === again);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 2: it threw", error instanceof Error);
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
    const result = Intl.DateTimeFormat.supportedLocalesOf(item, item);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, is it an operand:", result === item, result === item);
    const again = Intl.DateTimeFormat.supportedLocalesOf(item, item);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, does a second call answer the same thing:", result === again);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.DateTimeFormat.supportedLocalesOf(1.5, 2.5);
    const again = Intl.DateTimeFormat.supportedLocalesOf(1.5, 2.5);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, does a second call answer the same thing:", result === again);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.DateTimeFormat.supportedLocalesOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject.format(1.5);
    console.log("Intl.DateTimeFormat.prototype.format, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype.format:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype.format: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject.format;
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype.format, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject.formatRange(1.5, 2.5);
    console.log("Intl.DateTimeFormat.prototype.formatRange, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype.formatRange:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype.formatRange: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject.formatRangeToParts(1.5, 2.5);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0].type:", typeof result[0].type === "undefined", typeof result[0].type === "boolean", typeof result[0].type === "number", typeof result[0].type === "string", typeof result[0].type === "bigint", typeof result[0].type === "symbol", typeof result[0].type === "function", typeof result[0].type === "object", result[0].type === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0].value:", typeof result[0].value === "undefined", typeof result[0].value === "boolean", typeof result[0].value === "number", typeof result[0].value === "string", typeof result[0].value === "bigint", typeof result[0].value === "symbol", typeof result[0].value === "function", typeof result[0].value === "object", result[0].value === null);
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts[0].source:", typeof result[0].source === "undefined", typeof result[0].source === "boolean", typeof result[0].source === "number", typeof result[0].source === "string", typeof result[0].source === "bigint", typeof result[0].source === "symbol", typeof result[0].source === "function", typeof result[0].source === "object", result[0].source === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.DateTimeFormat.prototype.formatRangeToParts, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype.formatRangeToParts: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject.formatToParts(1.5);
    console.log("Intl.DateTimeFormat.prototype.formatToParts, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype.formatToParts:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.prototype.formatToParts, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.prototype.formatToParts, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.prototype.formatToParts, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.prototype.formatToParts, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.DateTimeFormat.prototype.formatToParts, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0].type:", typeof result[0].type === "undefined", typeof result[0].type === "boolean", typeof result[0].type === "number", typeof result[0].type === "string", typeof result[0].type === "bigint", typeof result[0].type === "symbol", typeof result[0].type === "function", typeof result[0].type === "object", result[0].type === null);
    console.log("Intl.DateTimeFormat.prototype.formatToParts[0].value:", typeof result[0].value === "undefined", typeof result[0].value === "boolean", typeof result[0].value === "number", typeof result[0].value === "string", typeof result[0].value === "bigint", typeof result[0].value === "symbol", typeof result[0].value === "function", typeof result[0].value === "object", result[0].value === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.formatToParts, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.DateTimeFormat.prototype.formatToParts, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype.formatToParts: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject.resolvedOptions();
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.resolvedOptions, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.resolvedOptions, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.DateTimeFormat.prototype.resolvedOptions, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions.locale:", typeof result.locale === "undefined", typeof result.locale === "boolean", typeof result.locale === "number", typeof result.locale === "string", typeof result.locale === "bigint", typeof result.locale === "symbol", typeof result.locale === "function", typeof result.locale === "object", result.locale === null);
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions.calendar:", typeof result.calendar === "undefined", typeof result.calendar === "boolean", typeof result.calendar === "number", typeof result.calendar === "string", typeof result.calendar === "bigint", typeof result.calendar === "symbol", typeof result.calendar === "function", typeof result.calendar === "object", result.calendar === null);
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions.numberingSystem:", typeof result.numberingSystem === "undefined", typeof result.numberingSystem === "boolean", typeof result.numberingSystem === "number", typeof result.numberingSystem === "string", typeof result.numberingSystem === "bigint", typeof result.numberingSystem === "symbol", typeof result.numberingSystem === "function", typeof result.numberingSystem === "object", result.numberingSystem === null);
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions.timeZone:", typeof result.timeZone === "undefined", typeof result.timeZone === "boolean", typeof result.timeZone === "number", typeof result.timeZone === "string", typeof result.timeZone === "bigint", typeof result.timeZone === "symbol", typeof result.timeZone === "function", typeof result.timeZone === "object", result.timeZone === null);
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype.resolvedOptions: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
    const result = subject[Symbol.toStringTag];
    console.log("Intl.DateTimeFormat.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Intl.DateTimeFormat.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.DateTimeFormat.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
