// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = "ab"[Symbol.iterator]();
    const result = subject.next();
    console.log("%StringIterator%.prototype.next, is it an operand:", result === subject);
    const again = subject.next();
    console.log("%StringIterator%.prototype.next, does a second call answer the same thing:", result === again);
    console.log("%StringIterator%.prototype.next:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%StringIterator%.prototype.next, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%StringIterator%.prototype.next, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%StringIterator%.prototype.next, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%StringIterator%.prototype.next, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%StringIterator%.prototype.next, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%StringIterator%.prototype.next, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%StringIterator%.prototype.next, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%StringIterator%.prototype.next, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%StringIterator%.prototype.next.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%StringIterator%.prototype.next.value, the text:", result.value.length === 0, result.value === "");
    console.log("%StringIterator%.prototype.next.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%StringIterator%.prototype.next.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%StringIterator%.prototype.next: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = ""[Symbol.iterator]();
    const result = subject.next();
    console.log("%StringIterator%.prototype.next, form 2, is it an operand:", result === subject);
    const again = subject.next();
    console.log("%StringIterator%.prototype.next, form 2, does a second call answer the same thing:", result === again);
    console.log("%StringIterator%.prototype.next, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%StringIterator%.prototype.next, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%StringIterator%.prototype.next, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%StringIterator%.prototype.next, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%StringIterator%.prototype.next, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%StringIterator%.prototype.next, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%StringIterator%.prototype.next, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%StringIterator%.prototype.next, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%StringIterator%.prototype.next, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%StringIterator%.prototype.next, form 2.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%StringIterator%.prototype.next, form 2.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%StringIterator%.prototype.next, form 2.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%StringIterator%.prototype.next, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = "ab"[Symbol.iterator]();
    const result = subject[Symbol.toStringTag];
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = ""[Symbol.iterator]();
    const result = subject[Symbol.toStringTag];
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%StringIterator%.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
