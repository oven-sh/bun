// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const first = new Uint8Array(0);
    class Below extends Float16Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("Float16Array, construct, form 4, from a class below, is it an operand:", result === first);
    console.log("Float16Array, construct, form 4, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float16Array, construct, form 4, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 4, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 4, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 4, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 4, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 4, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 4, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 4, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 4, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 4, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float16Array, construct, form 4, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float16Array, construct, form 4, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float16Array, construct, form 4, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float16Array, construct, form 4, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 4, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 4, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 4, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 4, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array(0);
    function Other() {}
    const result = Reflect.construct(Float16Array, [first], Other);
    console.log("Float16Array, construct, form 4, for another new.target, is it an operand:", result === first);
    console.log("Float16Array, construct, form 4, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float16Array, construct, form 4, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 4, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 4, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 4, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 4, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 4, for another new.target, how many keys:", Object.keys(result).length);
    console.log("Float16Array, construct, form 4, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 4, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float16Array, construct, form 4, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = new Float16Array(first, 2, 3);
    console.log("Float16Array, construct, form 7, is it an operand:", result === first);
    const again = new Float16Array(first, 2, 3);
    console.log("Float16Array, construct, form 7, does a second call answer the same thing:", result === again);
    console.log("Float16Array, construct, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 7, its own class:", Object.getPrototypeOf(result) === Float16Array.prototype, Reflect.getPrototypeOf(result) === Float16Array.prototype, result.constructor === Float16Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float16Array.prototype));
    console.log("Float16Array, construct, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 7, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 7, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 7, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 7, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    class Below extends Float16Array {
      mark = 1;
      constructor(p0, p1, p2) {
        super(p0, p1, p2);
        this.late = 2;
      }
    }
    const result = new Below(first, 2, 3);
    console.log("Float16Array, construct, form 7, from a class below, is it an operand:", result === first);
    console.log("Float16Array, construct, form 7, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float16Array, construct, form 7, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 7, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 7, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 7, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 7, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 7, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 7, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float16Array, construct, form 7, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float16Array, construct, form 7, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float16Array, construct, form 7, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float16Array, construct, form 7, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 7, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 7, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 7, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    function Other() {}
    const result = Reflect.construct(Float16Array, [first, 2, 3], Other);
    console.log("Float16Array, construct, form 7, for another new.target, is it an operand:", result === first);
    console.log("Float16Array, construct, form 7, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float16Array, construct, form 7, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 7, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 7, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 7, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 7, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 7, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 7, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 7, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 7, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float16Array, construct, form 7, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = new Float16Array(first, 0);
    console.log("Float16Array, construct, form 10, is it an operand:", result === first);
    const again = new Float16Array(first, 0);
    console.log("Float16Array, construct, form 10, does a second call answer the same thing:", result === again);
    console.log("Float16Array, construct, form 10:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 10, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 10, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 10, its own class:", Object.getPrototypeOf(result) === Float16Array.prototype, Reflect.getPrototypeOf(result) === Float16Array.prototype, result.constructor === Float16Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float16Array.prototype));
    console.log("Float16Array, construct, form 10, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 10, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 10, how many keys:", Object.keys(result).length);
    console.log("Float16Array, construct, form 10, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 10, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 10, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 10, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 10: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    class Below extends Float16Array {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(first, 0);
    console.log("Float16Array, construct, form 10, from a class below, is it an operand:", result === first);
    console.log("Float16Array, construct, form 10, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float16Array, construct, form 10, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 10, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 10, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 10, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 10, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 10, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 10, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 10, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 10, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 10, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float16Array, construct, form 10, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float16Array, construct, form 10, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float16Array, construct, form 10, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float16Array, construct, form 10, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 10, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 10, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 10, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 10, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    function Other() {}
    const result = Reflect.construct(Float16Array, [first, 0], Other);
    console.log("Float16Array, construct, form 10, for another new.target, is it an operand:", result === first);
    console.log("Float16Array, construct, form 10, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float16Array, construct, form 10, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 10, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 10, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 10, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 10, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 10, for another new.target, how many keys:", Object.keys(result).length);
    console.log("Float16Array, construct, form 10, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 10, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float16Array, construct, form 10, for another new.target: it threw", error instanceof Error);
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
    const result = new Float16Array(first);
    console.log("Float16Array, construct, form 13, is it an operand:", result === first);
    const again = new Float16Array(first);
    console.log("Float16Array, construct, form 13, does a second call answer the same thing:", result === again);
    console.log("Float16Array, construct, form 13:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 13, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 13, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 13, its own class:", Object.getPrototypeOf(result) === Float16Array.prototype, Reflect.getPrototypeOf(result) === Float16Array.prototype, result.constructor === Float16Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float16Array.prototype));
    console.log("Float16Array, construct, form 13, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 13, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 13, how many keys:", Object.keys(result).length);
    console.log("Float16Array, construct, form 13, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 13, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 13, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 13, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 13: it threw", error instanceof Error);
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
    class Below extends Float16Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("Float16Array, construct, form 13, from a class below, is it an operand:", result === first);
    console.log("Float16Array, construct, form 13, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float16Array, construct, form 13, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 13, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 13, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 13, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 13, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 13, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 13, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 13, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 13, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 13, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float16Array, construct, form 13, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float16Array, construct, form 13, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float16Array, construct, form 13, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float16Array, construct, form 13, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 13, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 13, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 13, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 13, from a class below: it threw", error instanceof Error);
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
    function Other() {}
    const result = Reflect.construct(Float16Array, [first], Other);
    console.log("Float16Array, construct, form 13, for another new.target, is it an operand:", result === first);
    console.log("Float16Array, construct, form 13, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float16Array, construct, form 13, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 13, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 13, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 13, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 13, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 13, for another new.target, how many keys:", Object.keys(result).length);
    console.log("Float16Array, construct, form 13, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 13, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float16Array, construct, form 13, for another new.target: it threw", error instanceof Error);
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
    const result = new Float16Array(first);
    console.log("Float16Array, construct, form 16, is it an operand:", result === first);
    const again = new Float16Array(first);
    console.log("Float16Array, construct, form 16, does a second call answer the same thing:", result === again);
    console.log("Float16Array, construct, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 16, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 16, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 16, its own class:", Object.getPrototypeOf(result) === Float16Array.prototype, Reflect.getPrototypeOf(result) === Float16Array.prototype, result.constructor === Float16Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float16Array.prototype));
    console.log("Float16Array, construct, form 16, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 16, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 16, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 16, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 16, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 16, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 16: it threw", error instanceof Error);
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
    class Below extends Float16Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("Float16Array, construct, form 16, from a class below, is it an operand:", result === first);
    console.log("Float16Array, construct, form 16, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float16Array, construct, form 16, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 16, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 16, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 16, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 16, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 16, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 16, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float16Array, construct, form 16, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float16Array, construct, form 16, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float16Array, construct, form 16, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float16Array, construct, form 16, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 16, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 16, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 16, from a class below: it threw", error instanceof Error);
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
    function Other() {}
    const result = Reflect.construct(Float16Array, [first], Other);
    console.log("Float16Array, construct, form 16, for another new.target, is it an operand:", result === first);
    console.log("Float16Array, construct, form 16, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float16Array, construct, form 16, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 16, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 16, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 16, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 16, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 16, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 16, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 16, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 16, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float16Array, construct, form 16, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Float16Array(1);
    const again = new Float16Array(1);
    console.log("Float16Array, construct, form 19, does a second call answer the same thing:", result === again);
    console.log("Float16Array, construct, form 19:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 19, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 19, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 19, its own class:", Object.getPrototypeOf(result) === Float16Array.prototype, Reflect.getPrototypeOf(result) === Float16Array.prototype, result.constructor === Float16Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float16Array.prototype));
    console.log("Float16Array, construct, form 19, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 19, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 19, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 19, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 19, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 19, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 19: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Float16Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(1);
    console.log("Float16Array, construct, form 19, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float16Array, construct, form 19, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 19, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 19, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 19, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 19, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 19, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 19, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float16Array, construct, form 19, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float16Array, construct, form 19, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float16Array, construct, form 19, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float16Array, construct, form 19, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 19, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float16Array, construct, form 19, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float16Array, construct, form 19, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Float16Array, [1], Other);
    console.log("Float16Array, construct, form 19, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float16Array, construct, form 19, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float16Array, construct, form 19, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float16Array, construct, form 19, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float16Array, construct, form 19, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float16Array, construct, form 19, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float16Array, construct, form 19, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float16Array, construct, form 19, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float16Array, construct, form 19, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float16Array, construct, form 19, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float16Array, construct, form 19, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array([1, 2, 3]);
    const result = new Float32Array(first);
    console.log("Float32Array, construct, is it an operand:", result === first);
    const again = new Float32Array(first);
    console.log("Float32Array, construct, does a second call answer the same thing:", result === again);
    console.log("Float32Array, construct:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, its own class:", Object.getPrototypeOf(result) === Float32Array.prototype, Reflect.getPrototypeOf(result) === Float32Array.prototype, result.constructor === Float32Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float32Array.prototype));
    console.log("Float32Array, construct, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array([1, 2, 3]);
    class Below extends Float32Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("Float32Array, construct, from a class below, is it an operand:", result === first);
    console.log("Float32Array, construct, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float32Array, construct, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float32Array, construct, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float32Array, construct, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float32Array, construct, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float32Array, construct, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array([1, 2, 3]);
    function Other() {}
    const result = Reflect.construct(Float32Array, [first], Other);
    console.log("Float32Array, construct, for another new.target, is it an operand:", result === first);
    console.log("Float32Array, construct, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float32Array, construct, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float32Array, construct, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array(0);
    const result = new Float32Array(first);
    console.log("Float32Array, construct, form 4, is it an operand:", result === first);
    const again = new Float32Array(first);
    console.log("Float32Array, construct, form 4, does a second call answer the same thing:", result === again);
    console.log("Float32Array, construct, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 4, its own class:", Object.getPrototypeOf(result) === Float32Array.prototype, Reflect.getPrototypeOf(result) === Float32Array.prototype, result.constructor === Float32Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float32Array.prototype));
    console.log("Float32Array, construct, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 4, how many keys:", Object.keys(result).length);
    console.log("Float32Array, construct, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array(0);
    class Below extends Float32Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("Float32Array, construct, form 4, from a class below, is it an operand:", result === first);
    console.log("Float32Array, construct, form 4, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float32Array, construct, form 4, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 4, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 4, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 4, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 4, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 4, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 4, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 4, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 4, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, form 4, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float32Array, construct, form 4, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float32Array, construct, form 4, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float32Array, construct, form 4, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float32Array, construct, form 4, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 4, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 4, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 4, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 4, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Uint8Array(0);
    function Other() {}
    const result = Reflect.construct(Float32Array, [first], Other);
    console.log("Float32Array, construct, form 4, for another new.target, is it an operand:", result === first);
    console.log("Float32Array, construct, form 4, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float32Array, construct, form 4, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 4, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 4, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 4, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 4, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 4, for another new.target, how many keys:", Object.keys(result).length);
    console.log("Float32Array, construct, form 4, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 4, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float32Array, construct, form 4, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = new Float32Array(first, 0);
    console.log("Float32Array, construct, form 7, is it an operand:", result === first);
    const again = new Float32Array(first, 0);
    console.log("Float32Array, construct, form 7, does a second call answer the same thing:", result === again);
    console.log("Float32Array, construct, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 7, its own class:", Object.getPrototypeOf(result) === Float32Array.prototype, Reflect.getPrototypeOf(result) === Float32Array.prototype, result.constructor === Float32Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float32Array.prototype));
    console.log("Float32Array, construct, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 7, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, form 7, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 7, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 7, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    class Below extends Float32Array {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(first, 0);
    console.log("Float32Array, construct, form 7, from a class below, is it an operand:", result === first);
    console.log("Float32Array, construct, form 7, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float32Array, construct, form 7, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 7, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 7, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 7, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 7, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 7, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, form 7, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float32Array, construct, form 7, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float32Array, construct, form 7, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float32Array, construct, form 7, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float32Array, construct, form 7, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 7, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 7, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 7, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    function Other() {}
    const result = Reflect.construct(Float32Array, [first, 0], Other);
    console.log("Float32Array, construct, form 7, for another new.target, is it an operand:", result === first);
    console.log("Float32Array, construct, form 7, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float32Array, construct, form 7, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 7, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 7, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 7, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 7, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 7, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 7, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, form 7, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 7, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float32Array, construct, form 7, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = new Float32Array(first, 0);
    console.log("Float32Array, construct, form 10, is it an operand:", result === first);
    const again = new Float32Array(first, 0);
    console.log("Float32Array, construct, form 10, does a second call answer the same thing:", result === again);
    console.log("Float32Array, construct, form 10:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 10, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 10, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 10, its own class:", Object.getPrototypeOf(result) === Float32Array.prototype, Reflect.getPrototypeOf(result) === Float32Array.prototype, result.constructor === Float32Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float32Array.prototype));
    console.log("Float32Array, construct, form 10, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 10, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 10, how many keys:", Object.keys(result).length);
    console.log("Float32Array, construct, form 10, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 10, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 10, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 10, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 10: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    class Below extends Float32Array {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(first, 0);
    console.log("Float32Array, construct, form 10, from a class below, is it an operand:", result === first);
    console.log("Float32Array, construct, form 10, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Float32Array, construct, form 10, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 10, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 10, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 10, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 10, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 10, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 10, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 10, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 10, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Float32Array, construct, form 10, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Float32Array, construct, form 10, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Float32Array, construct, form 10, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Float32Array, construct, form 10, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Float32Array, construct, form 10, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 10, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 10, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 10, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 10, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    function Other() {}
    const result = Reflect.construct(Float32Array, [first, 0], Other);
    console.log("Float32Array, construct, form 10, for another new.target, is it an operand:", result === first);
    console.log("Float32Array, construct, form 10, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Float32Array, construct, form 10, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 10, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 10, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 10, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 10, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 10, for another new.target, how many keys:", Object.keys(result).length);
    console.log("Float32Array, construct, form 10, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 10, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Float32Array, construct, form 10, for another new.target: it threw", error instanceof Error);
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
    const result = new Float32Array(first);
    console.log("Float32Array, construct, form 13, is it an operand:", result === first);
    const again = new Float32Array(first);
    console.log("Float32Array, construct, form 13, does a second call answer the same thing:", result === again);
    console.log("Float32Array, construct, form 13:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float32Array, construct, form 13, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Float32Array, construct, form 13, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Float32Array, construct, form 13, its own class:", Object.getPrototypeOf(result) === Float32Array.prototype, Reflect.getPrototypeOf(result) === Float32Array.prototype, result.constructor === Float32Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Float32Array.prototype));
    console.log("Float32Array, construct, form 13, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Float32Array, construct, form 13, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Float32Array, construct, form 13, how many keys:", Object.keys(result).length);
    console.log("Float32Array, construct, form 13, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Float32Array, construct, form 13, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Float32Array, construct, form 13, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Float32Array, construct, form 13, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Float32Array, construct, form 13: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
