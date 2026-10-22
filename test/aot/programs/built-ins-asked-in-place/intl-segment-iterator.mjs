// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Intl.Segmenter("en").segment("ab")[Symbol.iterator]();
    const result = subject.next();
    console.log("%IntlSegmentIterator%.prototype.next, is it an operand:", result === subject);
    const again = subject.next();
    console.log("%IntlSegmentIterator%.prototype.next, does a second call answer the same thing:", result === again);
    console.log("%IntlSegmentIterator%.prototype.next:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%IntlSegmentIterator%.prototype.next, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%IntlSegmentIterator%.prototype.next, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%IntlSegmentIterator%.prototype.next, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%IntlSegmentIterator%.prototype.next, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%IntlSegmentIterator%.prototype.next, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%IntlSegmentIterator%.prototype.next, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%IntlSegmentIterator%.prototype.next, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%IntlSegmentIterator%.prototype.next, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%IntlSegmentIterator%.prototype.next.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%IntlSegmentIterator%.prototype.next.value, the class:", Array.isArray(result.value), result.value instanceof Object, result.value instanceof Array, result.value instanceof Map, result.value instanceof Set, result.value instanceof Promise, result.value instanceof Date, result.value instanceof RegExp, result.value instanceof Error, result.value instanceof ArrayBuffer, result.value instanceof Uint8Array, result.value instanceof Function, ArrayBuffer.isView(result.value));
    console.log("%IntlSegmentIterator%.prototype.next.value, above it:", Object.getPrototypeOf(result.value) === Object.prototype, Object.getPrototypeOf(result.value) === Array.prototype, Object.getPrototypeOf(result.value) === null);
    console.log("%IntlSegmentIterator%.prototype.next.value, its state:", Object.isFrozen(result.value), Object.isSealed(result.value), Object.isExtensible(result.value));
    console.log("%IntlSegmentIterator%.prototype.next.value, names in it:", "length" in result.value, "size" in result.value, "then" in result.value, "next" in result.value, "constructor" in result.value, Symbol.iterator in result.value);
    console.log("%IntlSegmentIterator%.prototype.next.value, how many keys:", Object.keys(result.value).length);
    {
      let asked = 0;
      for (const value of Object.values(result.value)) {
        if (asked++ === 4) break;
        console.log("%IntlSegmentIterator%.prototype.next.value, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.value)) {
        if (asked++ === 4) break;
        console.log("%IntlSegmentIterator%.prototype.next.value, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.value) {
        if (asked++ === 4) break;
        console.log("%IntlSegmentIterator%.prototype.next.value, by for-in:", typeof key === "string", typeof result.value[key] === "undefined", typeof result.value[key] === "boolean", typeof result.value[key] === "number", typeof result.value[key] === "string", typeof result.value[key] === "bigint", typeof result.value[key] === "symbol", typeof result.value[key] === "function", typeof result.value[key] === "object", result.value[key] === null);
      }
    }
    console.log("%IntlSegmentIterator%.prototype.next.value.segment:", typeof result.value.segment === "undefined", typeof result.value.segment === "boolean", typeof result.value.segment === "number", typeof result.value.segment === "string", typeof result.value.segment === "bigint", typeof result.value.segment === "symbol", typeof result.value.segment === "function", typeof result.value.segment === "object", result.value.segment === null);
    console.log("%IntlSegmentIterator%.prototype.next.value.segment, the text:", result.value.segment.length === 0, result.value.segment === "");
    console.log("%IntlSegmentIterator%.prototype.next.value.index:", typeof result.value.index === "undefined", typeof result.value.index === "boolean", typeof result.value.index === "number", typeof result.value.index === "string", typeof result.value.index === "bigint", typeof result.value.index === "symbol", typeof result.value.index === "function", typeof result.value.index === "object", result.value.index === null);
    console.log("%IntlSegmentIterator%.prototype.next.value.index, the number:", Number.isInteger(result.value.index), result.value.index === result.value.index, result.value.index < 0, result.value.index > 2147483647, result.value.index < -2147483648, Object.is(result.value.index, -0), (result.value.index | 0) === result.value.index);
    console.log("%IntlSegmentIterator%.prototype.next.value.input:", typeof result.value.input === "undefined", typeof result.value.input === "boolean", typeof result.value.input === "number", typeof result.value.input === "string", typeof result.value.input === "bigint", typeof result.value.input === "symbol", typeof result.value.input === "function", typeof result.value.input === "object", result.value.input === null);
    console.log("%IntlSegmentIterator%.prototype.next.value.input, the text:", result.value.input.length === 0, result.value.input === "");
    console.log("%IntlSegmentIterator%.prototype.next.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%IntlSegmentIterator%.prototype.next.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%IntlSegmentIterator%.prototype.next: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
