// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new URLSearchParams("first=1").entries();
    const result = subject.next();
    console.log("%URLSearchParamsIterator%.prototype.next, is it an operand:", result === subject);
    const again = subject.next();
    console.log("%URLSearchParamsIterator%.prototype.next, does a second call answer the same thing:", result === again);
    console.log("%URLSearchParamsIterator%.prototype.next:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%URLSearchParamsIterator%.prototype.next, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%URLSearchParamsIterator%.prototype.next, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%URLSearchParamsIterator%.prototype.next, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%URLSearchParamsIterator%.prototype.next, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%URLSearchParamsIterator%.prototype.next, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%URLSearchParamsIterator%.prototype.next.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%URLSearchParamsIterator%.prototype.next.value, the class:", Array.isArray(result.value), result.value instanceof Object, result.value instanceof Array, result.value instanceof Map, result.value instanceof Set, result.value instanceof Promise, result.value instanceof Date, result.value instanceof RegExp, result.value instanceof Error, result.value instanceof ArrayBuffer, result.value instanceof Uint8Array, result.value instanceof Function, ArrayBuffer.isView(result.value));
    console.log("%URLSearchParamsIterator%.prototype.next.value, above it:", Object.getPrototypeOf(result.value) === Object.prototype, Object.getPrototypeOf(result.value) === Array.prototype, Object.getPrototypeOf(result.value) === null);
    console.log("%URLSearchParamsIterator%.prototype.next.value, its state:", Object.isFrozen(result.value), Object.isSealed(result.value), Object.isExtensible(result.value));
    console.log("%URLSearchParamsIterator%.prototype.next.value, names in it:", "length" in result.value, "size" in result.value, "then" in result.value, "next" in result.value, "constructor" in result.value, Symbol.iterator in result.value);
    console.log("%URLSearchParamsIterator%.prototype.next.value, how many keys:", Object.keys(result.value).length);
    {
      let asked = 0;
      for (const value of Object.values(result.value)) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next.value, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.value)) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next.value, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.value) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next.value, by for-in:", typeof key === "string", typeof result.value[key] === "undefined", typeof result.value[key] === "boolean", typeof result.value[key] === "number", typeof result.value[key] === "string", typeof result.value[key] === "bigint", typeof result.value[key] === "symbol", typeof result.value[key] === "function", typeof result.value[key] === "object", result.value[key] === null);
      }
    }
    console.log("%URLSearchParamsIterator%.prototype.next.value, by index:", typeof result.value[0] === "undefined", typeof result.value[0] === "boolean", typeof result.value[0] === "number", typeof result.value[0] === "string", typeof result.value[0] === "bigint", typeof result.value[0] === "symbol", typeof result.value[0] === "function", typeof result.value[0] === "object", result.value[0] === null);
    console.log("%URLSearchParamsIterator%.prototype.next.value, its length:", result.value.length === 0, result.value.length);
    {
      let asked = 0;
      for (const value of result.value) {
        if (asked++ === 4) break;
        console.log("%URLSearchParamsIterator%.prototype.next.value, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%URLSearchParamsIterator%.prototype.next.value, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
    console.log("%URLSearchParamsIterator%.prototype.next.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%URLSearchParamsIterator%.prototype.next.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%URLSearchParamsIterator%.prototype.next: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1").entries();
    const result = subject[Symbol.toStringTag];
    console.log("%URLSearchParamsIterator%.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("%URLSearchParamsIterator%.prototype[Symbol.toStringTag], get, is it a text that its row names:", result === "URLSearchParams Iterator");
    console.log("%URLSearchParamsIterator%.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%URLSearchParamsIterator%.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%URLSearchParamsIterator%.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
