// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = WeakRef.length;
    console.log("WeakRef.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("WeakRef.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakRef.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakRef.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = WeakRef.name;
    console.log("WeakRef.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakRef.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakRef.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakRef(key);
    const result = subject.deref();
    console.log("WeakRef.prototype.deref, is it an operand:", result === subject);
    console.log("WeakRef.prototype.deref:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakRef.prototype.deref, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakRef.prototype.deref, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakRef.prototype.deref, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakRef.prototype.deref, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakRef.prototype.deref, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("WeakRef.prototype.deref, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("WeakRef.prototype.deref, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("WeakRef.prototype.deref, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("WeakRef.prototype.deref.name:", typeof result.name === "undefined", typeof result.name === "boolean", typeof result.name === "number", typeof result.name === "string", typeof result.name === "bigint", typeof result.name === "symbol", typeof result.name === "function", typeof result.name === "object", result.name === null);
    console.log("WeakRef.prototype.deref.name, the number:", Number.isInteger(result.name), result.name === result.name, result.name < 0, result.name > 2147483647, result.name < -2147483648, Object.is(result.name, -0), (result.name | 0) === result.name);
  } catch (error) {
    console.log("WeakRef.prototype.deref: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakRef(key);
    const result = subject[Symbol.toStringTag];
    console.log("WeakRef.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("WeakRef.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakRef.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakRef.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
