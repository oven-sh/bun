// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Intl.Locale.length;
    console.log("Intl.Locale.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Intl.Locale.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Intl.Locale.name;
    console.log("Intl.Locale.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.baseName;
    console.log("Intl.Locale.prototype.baseName, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.baseName, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.baseName, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.calendar;
    console.log("Intl.Locale.prototype.calendar, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.calendar, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.calendar, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.caseFirst;
    console.log("Intl.Locale.prototype.caseFirst, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.caseFirst, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.caseFirst, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.collation;
    console.log("Intl.Locale.prototype.collation, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.collation, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.collation, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.firstDayOfWeek;
    console.log("Intl.Locale.prototype.firstDayOfWeek, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.firstDayOfWeek, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.firstDayOfWeek, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getCalendars();
    console.log("Intl.Locale.prototype.getCalendars, is it an operand:", result === subject);
    const again = subject.getCalendars();
    console.log("Intl.Locale.prototype.getCalendars, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.getCalendars:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getCalendars, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getCalendars, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getCalendars, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getCalendars, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCalendars, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCalendars, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCalendars, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getCalendars, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCalendars, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.Locale.prototype.getCalendars, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.Locale.prototype.getCalendars: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getCollations();
    console.log("Intl.Locale.prototype.getCollations, is it an operand:", result === subject);
    const again = subject.getCollations();
    console.log("Intl.Locale.prototype.getCollations, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.getCollations:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getCollations, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getCollations, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getCollations, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getCollations, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCollations, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCollations, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCollations, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getCollations, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getCollations, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.Locale.prototype.getCollations, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.Locale.prototype.getCollations: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getHourCycles();
    console.log("Intl.Locale.prototype.getHourCycles, is it an operand:", result === subject);
    const again = subject.getHourCycles();
    console.log("Intl.Locale.prototype.getHourCycles, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.getHourCycles:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getHourCycles, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getHourCycles, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getHourCycles, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getHourCycles, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getHourCycles, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getHourCycles, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getHourCycles, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getHourCycles, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getHourCycles, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.Locale.prototype.getHourCycles, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.Locale.prototype.getHourCycles: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getNumberingSystems();
    console.log("Intl.Locale.prototype.getNumberingSystems, is it an operand:", result === subject);
    const again = subject.getNumberingSystems();
    console.log("Intl.Locale.prototype.getNumberingSystems, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.getNumberingSystems:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getNumberingSystems, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getNumberingSystems, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getNumberingSystems, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getNumberingSystems, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getNumberingSystems, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getNumberingSystems, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getNumberingSystems, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getNumberingSystems, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getNumberingSystems, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.Locale.prototype.getNumberingSystems, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.Locale.prototype.getNumberingSystems: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getTextInfo();
    console.log("Intl.Locale.prototype.getTextInfo, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.getTextInfo:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getTextInfo, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getTextInfo, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getTextInfo, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getTextInfo, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTextInfo, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTextInfo, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTextInfo, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getTextInfo.direction:", typeof result.direction === "undefined", typeof result.direction === "boolean", typeof result.direction === "number", typeof result.direction === "string", typeof result.direction === "bigint", typeof result.direction === "symbol", typeof result.direction === "function", typeof result.direction === "object", result.direction === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.getTextInfo: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getTimeZones();
    console.log("Intl.Locale.prototype.getTimeZones, is it an operand:", result === subject);
    const again = subject.getTimeZones();
    console.log("Intl.Locale.prototype.getTimeZones, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.getTimeZones:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getTimeZones, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getTimeZones, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getTimeZones, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getTimeZones, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTimeZones, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTimeZones, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTimeZones, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getTimeZones, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getTimeZones, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.Locale.prototype.getTimeZones, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.Locale.prototype.getTimeZones: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.getWeekInfo();
    console.log("Intl.Locale.prototype.getWeekInfo, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.getWeekInfo:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.getWeekInfo, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.getWeekInfo, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.getWeekInfo, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.getWeekInfo, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getWeekInfo.firstDay:", typeof result.firstDay === "undefined", typeof result.firstDay === "boolean", typeof result.firstDay === "number", typeof result.firstDay === "string", typeof result.firstDay === "bigint", typeof result.firstDay === "symbol", typeof result.firstDay === "function", typeof result.firstDay === "object", result.firstDay === null);
    console.log("Intl.Locale.prototype.getWeekInfo.weekend:", typeof result.weekend === "undefined", typeof result.weekend === "boolean", typeof result.weekend === "number", typeof result.weekend === "string", typeof result.weekend === "bigint", typeof result.weekend === "symbol", typeof result.weekend === "function", typeof result.weekend === "object", result.weekend === null);
    console.log("Intl.Locale.prototype.getWeekInfo.weekend, the class:", Array.isArray(result.weekend), result.weekend instanceof Object, result.weekend instanceof Array, result.weekend instanceof Map, result.weekend instanceof Set, result.weekend instanceof Promise, result.weekend instanceof Date, result.weekend instanceof RegExp, result.weekend instanceof Error, result.weekend instanceof ArrayBuffer, result.weekend instanceof Uint8Array, result.weekend instanceof Function, ArrayBuffer.isView(result.weekend));
    console.log("Intl.Locale.prototype.getWeekInfo.weekend, above it:", Object.getPrototypeOf(result.weekend) === Object.prototype, Object.getPrototypeOf(result.weekend) === Array.prototype, Object.getPrototypeOf(result.weekend) === null);
    console.log("Intl.Locale.prototype.getWeekInfo.weekend, its state:", Object.isFrozen(result.weekend), Object.isSealed(result.weekend), Object.isExtensible(result.weekend));
    console.log("Intl.Locale.prototype.getWeekInfo.weekend, names in it:", "length" in result.weekend, "size" in result.weekend, "then" in result.weekend, "next" in result.weekend, "constructor" in result.weekend, Symbol.iterator in result.weekend);
    {
      let asked = 0;
      for (const value of Object.values(result.weekend)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo.weekend, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.weekend)) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo.weekend, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.weekend) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo.weekend, by for-in:", typeof key === "string", typeof result.weekend[key] === "undefined", typeof result.weekend[key] === "boolean", typeof result.weekend[key] === "number", typeof result.weekend[key] === "string", typeof result.weekend[key] === "bigint", typeof result.weekend[key] === "symbol", typeof result.weekend[key] === "function", typeof result.weekend[key] === "object", result.weekend[key] === null);
      }
    }
    console.log("Intl.Locale.prototype.getWeekInfo.weekend, by index:", typeof result.weekend[0] === "undefined", typeof result.weekend[0] === "boolean", typeof result.weekend[0] === "number", typeof result.weekend[0] === "string", typeof result.weekend[0] === "bigint", typeof result.weekend[0] === "symbol", typeof result.weekend[0] === "function", typeof result.weekend[0] === "object", result.weekend[0] === null);
    {
      let asked = 0;
      for (const value of result.weekend) {
        if (asked++ === 4) break;
        console.log("Intl.Locale.prototype.getWeekInfo.weekend, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Intl.Locale.prototype.getWeekInfo.weekend, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Intl.Locale.prototype.getWeekInfo: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.hourCycle;
    console.log("Intl.Locale.prototype.hourCycle, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.hourCycle, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.hourCycle, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.language;
    console.log("Intl.Locale.prototype.language, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.language, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.language, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.maximize();
    console.log("Intl.Locale.prototype.maximize, is it an operand:", result === subject);
    const again = subject.maximize();
    console.log("Intl.Locale.prototype.maximize, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.maximize:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.maximize, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.maximize, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.maximize, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.maximize, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Intl.Locale.prototype.maximize: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.minimize();
    console.log("Intl.Locale.prototype.minimize, is it an operand:", result === subject);
    const again = subject.minimize();
    console.log("Intl.Locale.prototype.minimize, does a second call answer the same thing:", result === again);
    console.log("Intl.Locale.prototype.minimize:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Intl.Locale.prototype.minimize, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Intl.Locale.prototype.minimize, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Intl.Locale.prototype.minimize, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Intl.Locale.prototype.minimize, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Intl.Locale.prototype.minimize: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.numberingSystem;
    console.log("Intl.Locale.prototype.numberingSystem, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.numberingSystem, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.numberingSystem, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.numeric;
    console.log("Intl.Locale.prototype.numeric, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.numeric, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.numeric, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.region;
    console.log("Intl.Locale.prototype.region, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.region, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.region, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.script;
    console.log("Intl.Locale.prototype.script, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.script, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.script, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.toString();
    console.log("Intl.Locale.prototype.toString, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject.variants;
    console.log("Intl.Locale.prototype.variants, get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype.variants, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype.variants, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Intl.Locale("en-US");
    const result = subject[Symbol.toStringTag];
    console.log("Intl.Locale.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Intl.Locale.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Intl.Locale.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
