// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = new Object(Symbol.for("name"));
    const again = new Object(Symbol.for("name"));
    console.log("Object, construct, form 28, does a second call answer the same thing:", result === again);
    console.log("Object, construct, form 28:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object, construct, form 28, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object, construct, form 28, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object, construct, form 28, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object, construct, form 28, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object, construct, form 28, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object, construct, form 28: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Object {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(Symbol.for("name"));
    console.log("Object, construct, form 28, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Object, construct, form 28, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object, construct, form 28, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object, construct, form 28, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object, construct, form 28, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object, construct, form 28, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object, construct, form 28, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object, construct, form 28, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object, construct, form 28, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object, construct, form 28, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object, construct, form 28, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Object, construct, form 28, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Object, construct, form 28, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Object, construct, form 28, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("Object, construct, form 28, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Object, [Symbol.for("name")], Other);
    console.log("Object, construct, form 28, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Object, construct, form 28, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object, construct, form 28, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object, construct, form 28, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object, construct, form 28, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object, construct, form 28, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object, construct, form 28, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object, construct, form 28, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Object(5n);
    const again = new Object(5n);
    console.log("Object, construct, form 31, does a second call answer the same thing:", result === again);
    console.log("Object, construct, form 31:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object, construct, form 31, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object, construct, form 31, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object, construct, form 31, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object, construct, form 31, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object, construct, form 31, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object, construct, form 31: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Object {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(5n);
    console.log("Object, construct, form 31, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Object, construct, form 31, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object, construct, form 31, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object, construct, form 31, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object, construct, form 31, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object, construct, form 31, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object, construct, form 31, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object, construct, form 31, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object, construct, form 31, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object, construct, form 31, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object, construct, form 31, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Object, construct, form 31, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Object, construct, form 31, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Object, construct, form 31, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("Object, construct, form 31, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Object, [5n], Other);
    console.log("Object, construct, form 31, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Object, construct, form 31, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object, construct, form 31, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object, construct, form 31, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object, construct, form 31, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object, construct, form 31, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object, construct, form 31, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object, construct, form 31, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = new Promise(callback);
    console.log("Promise, construct, is it an operand:", result === callback);
    const again = new Promise(callback);
    console.log("Promise, construct, does a second call answer the same thing:", result === again);
    console.log("Promise, construct:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise, construct, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise, construct, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise, construct, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Promise, construct, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise, construct, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise, construct, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise, construct: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    class Below extends Promise {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(callback);
    console.log("Promise, construct, from a class below, is it an operand:", result === callback);
    console.log("Promise, construct, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Promise, construct, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise, construct, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise, construct, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise, construct, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise, construct, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise, construct, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Promise, construct, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Promise, construct, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Promise, construct, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Promise, construct, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Promise, construct, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Promise, construct, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Promise, construct, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("Promise, construct, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    function Other() {}
    const result = Reflect.construct(Promise, [callback], Other);
    console.log("Promise, construct, for another new.target, is it an operand:", result === callback);
    console.log("Promise, construct, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Promise, construct, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Promise, construct, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Promise, construct, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Promise, construct, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Promise, construct, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Promise, construct, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Promise, construct, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RangeError("an", 2.5);
    const again = RangeError("an", 2.5);
    console.log("RangeError, does a second call answer the same thing:", result === again);
    console.log("RangeError:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RangeError("an", "-");
    const again = RangeError("an", "-");
    console.log("RangeError, form 2, does a second call answer the same thing:", result === again);
    console.log("RangeError, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, form 2, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, form 2: it threw", error instanceof Error);
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
    const result = RangeError("an", item);
    console.log("RangeError, form 3, is it an operand:", result === item);
    const again = RangeError("an", item);
    console.log("RangeError, form 3, does a second call answer the same thing:", result === again);
    console.log("RangeError, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, form 3, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RangeError("an", 2.5);
    const again = RangeError("an", 2.5);
    console.log("RangeError, form 4, does a second call answer the same thing:", result === again);
    console.log("RangeError, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, form 4, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new RangeError("an", 2.5);
    const again = new RangeError("an", 2.5);
    console.log("RangeError, construct, form 5, does a second call answer the same thing:", result === again);
    console.log("RangeError, construct, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 5, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, construct, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, construct, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends RangeError {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", 2.5);
    console.log("RangeError, construct, form 5, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("RangeError, construct, form 5, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 5, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 5, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 5, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 5, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 5, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 5, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 5, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 5, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RangeError, construct, form 5, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("RangeError, construct, form 5, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("RangeError, construct, form 5, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("RangeError, construct, form 5, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("RangeError, construct, form 5, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(RangeError, ["an", 2.5], Other);
    console.log("RangeError, construct, form 5, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("RangeError, construct, form 5, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 5, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 5, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 5, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 5, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 5, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, construct, form 5, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new RangeError("an", "-");
    const again = new RangeError("an", "-");
    console.log("RangeError, construct, form 8, does a second call answer the same thing:", result === again);
    console.log("RangeError, construct, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 8, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, construct, form 8, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, construct, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends RangeError {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", "-");
    console.log("RangeError, construct, form 8, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("RangeError, construct, form 8, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 8, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 8, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 8, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 8, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 8, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 8, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 8, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 8, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RangeError, construct, form 8, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("RangeError, construct, form 8, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("RangeError, construct, form 8, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("RangeError, construct, form 8, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("RangeError, construct, form 8, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(RangeError, ["an", "-"], Other);
    console.log("RangeError, construct, form 8, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("RangeError, construct, form 8, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 8, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 8, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 8, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 8, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 8, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, construct, form 8, for another new.target: it threw", error instanceof Error);
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
    const result = new RangeError("an", item);
    console.log("RangeError, construct, form 11, is it an operand:", result === item);
    const again = new RangeError("an", item);
    console.log("RangeError, construct, form 11, does a second call answer the same thing:", result === again);
    console.log("RangeError, construct, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 11, its own class:", Object.getPrototypeOf(result) === RangeError.prototype, Reflect.getPrototypeOf(result) === RangeError.prototype, result.constructor === RangeError, Object.getPrototypeOf(result) === Object.getPrototypeOf(RangeError.prototype));
    console.log("RangeError, construct, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, construct, form 11: it threw", error instanceof Error);
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
    class Below extends RangeError {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", item);
    console.log("RangeError, construct, form 11, from a class below, is it an operand:", result === item);
    console.log("RangeError, construct, form 11, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("RangeError, construct, form 11, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 11, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 11, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 11, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 11, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 11, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 11, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 11, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RangeError, construct, form 11, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RangeError, construct, form 11, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("RangeError, construct, form 11, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("RangeError, construct, form 11, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("RangeError, construct, form 11, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("RangeError, construct, form 11, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(RangeError, ["an", item], Other);
    console.log("RangeError, construct, form 11, for another new.target, is it an operand:", result === item);
    console.log("RangeError, construct, form 11, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("RangeError, construct, form 11, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError, construct, form 11, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RangeError, construct, form 11, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RangeError, construct, form 11, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RangeError, construct, form 11, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RangeError, construct, form 11, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RangeError, construct, form 11, for another new.target: it threw", error instanceof Error);
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
    const result = new ReadableStream(first);
    console.log("ReadableStream, construct, is it an operand:", result === first);
    const again = new ReadableStream(first);
    console.log("ReadableStream, construct, does a second call answer the same thing:", result === again);
    console.log("ReadableStream, construct:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReadableStream, construct: it threw", error instanceof Error);
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
    class Below extends ReadableStream {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("ReadableStream, construct, from a class below, is it an operand:", result === first);
    console.log("ReadableStream, construct, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("ReadableStream, construct, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("ReadableStream, construct, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("ReadableStream, construct, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("ReadableStream, construct, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("ReadableStream, construct, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("ReadableStream, construct, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(ReadableStream, [first], Other);
    console.log("ReadableStream, construct, for another new.target, is it an operand:", result === first);
    console.log("ReadableStream, construct, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("ReadableStream, construct, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReadableStream, construct, for another new.target: it threw", error instanceof Error);
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
    const result = new ReadableStream(first);
    console.log("ReadableStream, construct, form 4, is it an operand:", result === first);
    const again = new ReadableStream(first);
    console.log("ReadableStream, construct, form 4, does a second call answer the same thing:", result === again);
    console.log("ReadableStream, construct, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReadableStream, construct, form 4: it threw", error instanceof Error);
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
    class Below extends ReadableStream {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("ReadableStream, construct, form 4, from a class below, is it an operand:", result === first);
    console.log("ReadableStream, construct, form 4, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("ReadableStream, construct, form 4, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, form 4, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, form 4, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, form 4, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, form 4, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, form 4, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, form 4, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, form 4, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, form 4, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("ReadableStream, construct, form 4, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("ReadableStream, construct, form 4, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("ReadableStream, construct, form 4, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("ReadableStream, construct, form 4, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("ReadableStream, construct, form 4, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(ReadableStream, [first], Other);
    console.log("ReadableStream, construct, form 4, for another new.target, is it an operand:", result === first);
    console.log("ReadableStream, construct, form 4, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("ReadableStream, construct, form 4, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, form 4, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, form 4, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, form 4, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, form 4, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, form 4, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReadableStream, construct, form 4, for another new.target: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = new ReadableStream(item, second);
    console.log("ReadableStream, construct, form 7, is it an operand:", result === item, result === second);
    const again = new ReadableStream(item, second);
    console.log("ReadableStream, construct, form 7, does a second call answer the same thing:", result === again);
    console.log("ReadableStream, construct, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, form 7, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("ReadableStream, construct, form 7: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    class Below extends ReadableStream {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(item, second);
    console.log("ReadableStream, construct, form 7, from a class below, is it an operand:", result === item, result === second);
    console.log("ReadableStream, construct, form 7, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("ReadableStream, construct, form 7, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("ReadableStream, construct, form 7, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("ReadableStream, construct, form 7, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("ReadableStream, construct, form 7, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("ReadableStream, construct, form 7, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("ReadableStream, construct, form 7, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, form 7, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, form 7, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("ReadableStream, construct, form 7, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("ReadableStream, construct, form 7, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("ReadableStream, construct, form 7, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("ReadableStream, construct, form 7, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("ReadableStream, construct, form 7, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("ReadableStream, construct, form 7, from a class below: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
