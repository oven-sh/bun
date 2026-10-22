// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
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
    const second = { first: 1.5, second: "two", third: item };
    function Other() {}
    const result = Reflect.construct(ReadableStream, [item, second], Other);
    console.log("ReadableStream, construct, form 7, for another new.target, is it an operand:", result === item, result === second);
    console.log("ReadableStream, construct, form 7, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("ReadableStream, construct, form 7, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, form 7, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, form 7, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, form 7, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, form 7, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, form 7, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReadableStream, construct, form 7, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ReferenceError("an", 2.5);
    const again = ReferenceError("an", 2.5);
    console.log("ReferenceError, does a second call answer the same thing:", result === again);
    console.log("ReferenceError:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ReferenceError("an", "-");
    const again = ReferenceError("an", "-");
    console.log("ReferenceError, form 2, does a second call answer the same thing:", result === again);
    console.log("ReferenceError, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, form 2, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, form 2: it threw", error instanceof Error);
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
    const result = ReferenceError("an", item);
    console.log("ReferenceError, form 3, is it an operand:", result === item);
    const again = ReferenceError("an", item);
    console.log("ReferenceError, form 3, does a second call answer the same thing:", result === again);
    console.log("ReferenceError, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, form 3, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = ReferenceError("an", 2.5);
    const again = ReferenceError("an", 2.5);
    console.log("ReferenceError, form 4, does a second call answer the same thing:", result === again);
    console.log("ReferenceError, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, form 4, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new ReferenceError("an", 2.5);
    const again = new ReferenceError("an", 2.5);
    console.log("ReferenceError, construct, form 5, does a second call answer the same thing:", result === again);
    console.log("ReferenceError, construct, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 5, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, construct, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, construct, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends ReferenceError {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", 2.5);
    console.log("ReferenceError, construct, form 5, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("ReferenceError, construct, form 5, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 5, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 5, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 5, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 5, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 5, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 5, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 5, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 5, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("ReferenceError, construct, form 5, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("ReferenceError, construct, form 5, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("ReferenceError, construct, form 5, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("ReferenceError, construct, form 5, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("ReferenceError, construct, form 5, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(ReferenceError, ["an", 2.5], Other);
    console.log("ReferenceError, construct, form 5, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("ReferenceError, construct, form 5, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 5, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 5, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 5, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 5, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 5, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, construct, form 5, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new ReferenceError("an", "-");
    const again = new ReferenceError("an", "-");
    console.log("ReferenceError, construct, form 8, does a second call answer the same thing:", result === again);
    console.log("ReferenceError, construct, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 8, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, construct, form 8, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, construct, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends ReferenceError {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", "-");
    console.log("ReferenceError, construct, form 8, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("ReferenceError, construct, form 8, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 8, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 8, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 8, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 8, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 8, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 8, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 8, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 8, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("ReferenceError, construct, form 8, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("ReferenceError, construct, form 8, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("ReferenceError, construct, form 8, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("ReferenceError, construct, form 8, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("ReferenceError, construct, form 8, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(ReferenceError, ["an", "-"], Other);
    console.log("ReferenceError, construct, form 8, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("ReferenceError, construct, form 8, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 8, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 8, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 8, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 8, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 8, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, construct, form 8, for another new.target: it threw", error instanceof Error);
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
    const result = new ReferenceError("an", item);
    console.log("ReferenceError, construct, form 11, is it an operand:", result === item);
    const again = new ReferenceError("an", item);
    console.log("ReferenceError, construct, form 11, does a second call answer the same thing:", result === again);
    console.log("ReferenceError, construct, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 11, its own class:", Object.getPrototypeOf(result) === ReferenceError.prototype, Reflect.getPrototypeOf(result) === ReferenceError.prototype, result.constructor === ReferenceError, Object.getPrototypeOf(result) === Object.getPrototypeOf(ReferenceError.prototype));
    console.log("ReferenceError, construct, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, construct, form 11: it threw", error instanceof Error);
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
    class Below extends ReferenceError {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", item);
    console.log("ReferenceError, construct, form 11, from a class below, is it an operand:", result === item);
    console.log("ReferenceError, construct, form 11, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("ReferenceError, construct, form 11, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 11, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 11, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 11, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 11, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 11, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 11, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 11, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("ReferenceError, construct, form 11, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("ReferenceError, construct, form 11, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("ReferenceError, construct, form 11, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("ReferenceError, construct, form 11, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("ReferenceError, construct, form 11, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("ReferenceError, construct, form 11, from a class below: it threw", error instanceof Error);
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
    function Other() {}
    const result = Reflect.construct(ReferenceError, ["an", item], Other);
    console.log("ReferenceError, construct, form 11, for another new.target, is it an operand:", result === item);
    console.log("ReferenceError, construct, form 11, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("ReferenceError, construct, form 11, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReferenceError, construct, form 11, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReferenceError, construct, form 11, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReferenceError, construct, form 11, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReferenceError, construct, form 11, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReferenceError, construct, form 11, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReferenceError, construct, form 11, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp("an", undefined);
    const again = RegExp("an", undefined);
    console.log("RegExp, does a second call answer the same thing:", result === again);
    console.log("RegExp:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp("an", undefined);
    const again = RegExp("an", undefined);
    console.log("RegExp, form 2, does a second call answer the same thing:", result === again);
    console.log("RegExp, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, form 2, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = RegExp(first, undefined);
    console.log("RegExp, form 3, is it an operand:", result === first);
    console.log("RegExp, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, form 3, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp(null, undefined);
    const again = RegExp(null, undefined);
    console.log("RegExp, form 4, does a second call answer the same thing:", result === again);
    console.log("RegExp, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, form 4, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp(1.5);
    console.log("RegExp, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, form 5, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp("an");
    console.log("RegExp, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, form 6, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, form 6: it threw", error instanceof Error);
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
    const result = RegExp(item);
    console.log("RegExp, form 7, is it an operand:", result === item);
    console.log("RegExp, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, form 7, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, form 7, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new RegExp("an", undefined);
    const again = new RegExp("an", undefined);
    console.log("RegExp, construct, form 8, does a second call answer the same thing:", result === again);
    console.log("RegExp, construct, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 8, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, construct, form 8, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, construct, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends RegExp {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", undefined);
    console.log("RegExp, construct, form 8, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("RegExp, construct, form 8, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 8, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 8, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 8, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 8, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 8, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 8, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 8, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 8, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RegExp, construct, form 8, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("RegExp, construct, form 8, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("RegExp, construct, form 8, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("RegExp, construct, form 8, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("RegExp, construct, form 8, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(RegExp, ["an", undefined], Other);
    console.log("RegExp, construct, form 8, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("RegExp, construct, form 8, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 8, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 8, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 8, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 8, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 8, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, construct, form 8, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = new RegExp(first, undefined);
    console.log("RegExp, construct, form 11, is it an operand:", result === first);
    const again = new RegExp(first, undefined);
    console.log("RegExp, construct, form 11, does a second call answer the same thing:", result === again);
    console.log("RegExp, construct, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 11, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, construct, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, construct, form 11: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    class Below extends RegExp {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(first, undefined);
    console.log("RegExp, construct, form 11, from a class below, is it an operand:", result === first);
    console.log("RegExp, construct, form 11, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("RegExp, construct, form 11, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 11, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 11, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 11, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 11, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 11, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 11, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 11, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 11, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RegExp, construct, form 11, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("RegExp, construct, form 11, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("RegExp, construct, form 11, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("RegExp, construct, form 11, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("RegExp, construct, form 11, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    function Other() {}
    const result = Reflect.construct(RegExp, [first, undefined], Other);
    console.log("RegExp, construct, form 11, for another new.target, is it an operand:", result === first);
    console.log("RegExp, construct, form 11, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("RegExp, construct, form 11, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 11, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 11, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 11, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 11, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 11, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, construct, form 11, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new RegExp(null, undefined);
    const again = new RegExp(null, undefined);
    console.log("RegExp, construct, form 14, does a second call answer the same thing:", result === again);
    console.log("RegExp, construct, form 14:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 14, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 14, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 14, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp, construct, form 14, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 14, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 14, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, construct, form 14: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends RegExp {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(null, undefined);
    console.log("RegExp, construct, form 14, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("RegExp, construct, form 14, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 14, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 14, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 14, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 14, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 14, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 14, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 14, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RegExp, construct, form 14, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RegExp, construct, form 14, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("RegExp, construct, form 14, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("RegExp, construct, form 14, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("RegExp, construct, form 14, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("RegExp, construct, form 14, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(RegExp, [null, undefined], Other);
    console.log("RegExp, construct, form 14, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("RegExp, construct, form 14, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp, construct, form 14, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp, construct, form 14, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp, construct, form 14, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp, construct, form 14, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp, construct, form 14, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp, construct, form 14, for another new.target: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
