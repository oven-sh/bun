// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Intl.PluralRules.length;
    console.log("Intl.PluralRules.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Intl.PluralRules.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.PluralRules.name;
    console.log("Intl.PluralRules.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.PluralRules.supportedLocalesOf(1.5, 2.5);
    const again = Intl.PluralRules.supportedLocalesOf(1.5, 2.5);
    console.log("Intl.PluralRules.supportedLocalesOf, does a second call answer the same thing:", result === again);
    console.log("Intl.PluralRules.supportedLocalesOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.PluralRules.supportedLocalesOf, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.PluralRules.supportedLocalesOf, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.PluralRules.supportedLocalesOf, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.PluralRules.supportedLocalesOf, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.PluralRules.supportedLocalesOf, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.supportedLocalesOf, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.PluralRules.supportedLocalesOf, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.PluralRules.supportedLocalesOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.PluralRules.supportedLocalesOf("an", 2.5);
    const again = Intl.PluralRules.supportedLocalesOf("an", 2.5);
    console.log("Intl.PluralRules.supportedLocalesOf, form 2, does a second call answer the same thing:", result === again);
    console.log("Intl.PluralRules.supportedLocalesOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.PluralRules.supportedLocalesOf, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.PluralRules.supportedLocalesOf, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.PluralRules.supportedLocalesOf, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.PluralRules.supportedLocalesOf, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.PluralRules.supportedLocalesOf, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.supportedLocalesOf, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.PluralRules.supportedLocalesOf, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.PluralRules.supportedLocalesOf, form 2: it threw", error instanceof Error);
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
    const result = Intl.PluralRules.supportedLocalesOf(item, item);
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, is it an operand:", result === item, result === item);
    const again = Intl.PluralRules.supportedLocalesOf(item, item);
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, does a second call answer the same thing:", result === again);
    console.log("Intl.PluralRules.supportedLocalesOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.PluralRules.supportedLocalesOf, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.supportedLocalesOf, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.PluralRules.supportedLocalesOf, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.PluralRules.supportedLocalesOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.PluralRules.supportedLocalesOf(1.5, 2.5);
    const again = Intl.PluralRules.supportedLocalesOf(1.5, 2.5);
    console.log("Intl.PluralRules.supportedLocalesOf, form 4, does a second call answer the same thing:", result === again);
    console.log("Intl.PluralRules.supportedLocalesOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.PluralRules.supportedLocalesOf, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.PluralRules.supportedLocalesOf, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.PluralRules.supportedLocalesOf, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.PluralRules.supportedLocalesOf, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Intl.PluralRules.supportedLocalesOf, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.supportedLocalesOf, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.PluralRules.supportedLocalesOf, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.PluralRules.supportedLocalesOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.PluralRules("en");
    const result = subject.resolvedOptions();
    console.log("Intl.PluralRules.prototype.resolvedOptions, is it an operand:", result === subject);
    console.log("Intl.PluralRules.prototype.resolvedOptions:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.PluralRules.prototype.resolvedOptions, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.PluralRules.prototype.resolvedOptions, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.PluralRules.prototype.resolvedOptions, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.PluralRules.prototype.resolvedOptions, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.prototype.resolvedOptions, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.prototype.resolvedOptions, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.PluralRules.prototype.resolvedOptions, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.PluralRules.prototype.resolvedOptions.locale:", typeof result.locale === "undefined", typeof result.locale === "boolean", typeof result.locale === "number", typeof result.locale === "string", typeof result.locale === "bigint", typeof result.locale === "symbol", typeof result.locale === "function", typeof result.locale === "object", result.locale === null);
    console.log("Intl.PluralRules.prototype.resolvedOptions.type:", typeof result.type === "undefined", typeof result.type === "boolean", typeof result.type === "number", typeof result.type === "string", typeof result.type === "bigint", typeof result.type === "symbol", typeof result.type === "function", typeof result.type === "object", result.type === null);
    console.log("Intl.PluralRules.prototype.resolvedOptions.notation:", typeof result.notation === "undefined", typeof result.notation === "boolean", typeof result.notation === "number", typeof result.notation === "string", typeof result.notation === "bigint", typeof result.notation === "symbol", typeof result.notation === "function", typeof result.notation === "object", result.notation === null);
    console.log("Intl.PluralRules.prototype.resolvedOptions.minimumIntegerDigits:", typeof result.minimumIntegerDigits === "undefined", typeof result.minimumIntegerDigits === "boolean", typeof result.minimumIntegerDigits === "number", typeof result.minimumIntegerDigits === "string", typeof result.minimumIntegerDigits === "bigint", typeof result.minimumIntegerDigits === "symbol", typeof result.minimumIntegerDigits === "function", typeof result.minimumIntegerDigits === "object", result.minimumIntegerDigits === null);
  } catch (error) {
    console.log("Intl.PluralRules.prototype.resolvedOptions: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.PluralRules("en");
    const result = subject.select(1.5);
    console.log("Intl.PluralRules.prototype.select, is it an operand:", result === subject);
    console.log("Intl.PluralRules.prototype.select:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.prototype.select: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.PluralRules("en");
    const result = subject.select("an");
    console.log("Intl.PluralRules.prototype.select, form 2, is it an operand:", result === subject);
    console.log("Intl.PluralRules.prototype.select, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.prototype.select, form 2: it threw", error instanceof Error);
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
    const subject = new Intl.PluralRules("en");
    const result = subject.select(item);
    console.log("Intl.PluralRules.prototype.select, form 3, is it an operand:", result === subject, result === item);
    console.log("Intl.PluralRules.prototype.select, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.prototype.select, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.PluralRules("en");
    const result = subject.selectRange(1.5, 2.5);
    console.log("Intl.PluralRules.prototype.selectRange, is it an operand:", result === subject);
    console.log("Intl.PluralRules.prototype.selectRange:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.prototype.selectRange: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.PluralRules("en");
    const result = subject[Symbol.toStringTag];
    console.log("Intl.PluralRules.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Intl.PluralRules.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.PluralRules.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
