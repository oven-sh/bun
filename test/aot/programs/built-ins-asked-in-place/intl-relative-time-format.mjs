// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Intl.RelativeTimeFormat.length;
    console.log("Intl.RelativeTimeFormat.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Intl.RelativeTimeFormat.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.RelativeTimeFormat.name;
    console.log("Intl.RelativeTimeFormat.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.RelativeTimeFormat.supportedLocalesOf(1.5, 2.5);
    const again = Intl.RelativeTimeFormat.supportedLocalesOf(1.5, 2.5);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, does a second call answer the same thing:", result === again);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.supportedLocalesOf, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.RelativeTimeFormat.supportedLocalesOf, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.RelativeTimeFormat.supportedLocalesOf("an", 2.5);
    const again = Intl.RelativeTimeFormat.supportedLocalesOf("an", 2.5);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, does a second call answer the same thing:", result === again);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 2: it threw", error instanceof Error);
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
    const result = Intl.RelativeTimeFormat.supportedLocalesOf(item, item);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, is it an operand:", result === item, result === item);
    const again = Intl.RelativeTimeFormat.supportedLocalesOf(item, item);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, does a second call answer the same thing:", result === again);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.RelativeTimeFormat.supportedLocalesOf(1.5, 2.5);
    const again = Intl.RelativeTimeFormat.supportedLocalesOf(1.5, 2.5);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, does a second call answer the same thing:", result === again);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.supportedLocalesOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.RelativeTimeFormat("en");
    const result = subject.resolvedOptions();
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, is it an operand:", result === subject);
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions.locale:", typeof result.locale === "undefined", typeof result.locale === "boolean", typeof result.locale === "number", typeof result.locale === "string", typeof result.locale === "bigint", typeof result.locale === "symbol", typeof result.locale === "function", typeof result.locale === "object", result.locale === null);
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions.style:", typeof result.style === "undefined", typeof result.style === "boolean", typeof result.style === "number", typeof result.style === "string", typeof result.style === "bigint", typeof result.style === "symbol", typeof result.style === "function", typeof result.style === "object", result.style === null);
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions.numeric:", typeof result.numeric === "undefined", typeof result.numeric === "boolean", typeof result.numeric === "number", typeof result.numeric === "string", typeof result.numeric === "bigint", typeof result.numeric === "symbol", typeof result.numeric === "function", typeof result.numeric === "object", result.numeric === null);
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions.numberingSystem:", typeof result.numberingSystem === "undefined", typeof result.numberingSystem === "boolean", typeof result.numberingSystem === "number", typeof result.numberingSystem === "string", typeof result.numberingSystem === "bigint", typeof result.numberingSystem === "symbol", typeof result.numberingSystem === "function", typeof result.numberingSystem === "object", result.numberingSystem === null);
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.prototype.resolvedOptions: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.RelativeTimeFormat("en");
    const result = subject[Symbol.toStringTag];
    console.log("Intl.RelativeTimeFormat.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Intl.RelativeTimeFormat.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.RelativeTimeFormat.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
