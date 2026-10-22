// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = AggregateError("an", "-", 3.5);
    const again = AggregateError("an", "-", 3.5);
    console.log("AggregateError, does a second call answer the same thing:", result === again);
    console.log("AggregateError:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError: it threw", error instanceof Error);
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
    const result = AggregateError(first, "-", 3.5);
    console.log("AggregateError, form 2, is it an operand:", result === first);
    const again = AggregateError(first, "-", 3.5);
    console.log("AggregateError, form 2, does a second call answer the same thing:", result === again);
    console.log("AggregateError, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, form 2, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, form 2: it threw", error instanceof Error);
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
    const result = AggregateError("an", "-", item);
    console.log("AggregateError, form 3, is it an operand:", result === item);
    const again = AggregateError("an", "-", item);
    console.log("AggregateError, form 3, does a second call answer the same thing:", result === again);
    console.log("AggregateError, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, form 3, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = AggregateError("an", "-", 3.5);
    const again = AggregateError("an", "-", 3.5);
    console.log("AggregateError, form 4, does a second call answer the same thing:", result === again);
    console.log("AggregateError, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, form 4, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new AggregateError("an", "-", 3.5);
    const again = new AggregateError("an", "-", 3.5);
    console.log("AggregateError, construct, form 5, does a second call answer the same thing:", result === again);
    console.log("AggregateError, construct, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 5, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, construct, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, construct, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends AggregateError {
      mark = 1;
      constructor(p0, p1, p2) {
        super(p0, p1, p2);
        this.late = 2;
      }
    }
    const result = new Below("an", "-", 3.5);
    console.log("AggregateError, construct, form 5, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("AggregateError, construct, form 5, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 5, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 5, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 5, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 5, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 5, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 5, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 5, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 5, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AggregateError, construct, form 5, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("AggregateError, construct, form 5, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("AggregateError, construct, form 5, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("AggregateError, construct, form 5, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("AggregateError, construct, form 5, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(AggregateError, ["an", "-", 3.5], Other);
    console.log("AggregateError, construct, form 5, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("AggregateError, construct, form 5, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 5, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 5, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 5, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 5, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 5, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, construct, form 5, for another new.target: it threw", error instanceof Error);
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
    const result = new AggregateError(first, "-", 3.5);
    console.log("AggregateError, construct, form 8, is it an operand:", result === first);
    const again = new AggregateError(first, "-", 3.5);
    console.log("AggregateError, construct, form 8, does a second call answer the same thing:", result === again);
    console.log("AggregateError, construct, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 8, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, construct, form 8, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, construct, form 8: it threw", error instanceof Error);
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
    class Below extends AggregateError {
      mark = 1;
      constructor(p0, p1, p2) {
        super(p0, p1, p2);
        this.late = 2;
      }
    }
    const result = new Below(first, "-", 3.5);
    console.log("AggregateError, construct, form 8, from a class below, is it an operand:", result === first);
    console.log("AggregateError, construct, form 8, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("AggregateError, construct, form 8, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 8, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 8, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 8, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 8, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 8, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 8, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 8, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 8, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AggregateError, construct, form 8, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("AggregateError, construct, form 8, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("AggregateError, construct, form 8, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("AggregateError, construct, form 8, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("AggregateError, construct, form 8, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(AggregateError, [first, "-", 3.5], Other);
    console.log("AggregateError, construct, form 8, for another new.target, is it an operand:", result === first);
    console.log("AggregateError, construct, form 8, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("AggregateError, construct, form 8, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 8, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 8, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 8, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 8, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 8, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, construct, form 8, for another new.target: it threw", error instanceof Error);
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
    const result = new AggregateError("an", "-", item);
    console.log("AggregateError, construct, form 11, is it an operand:", result === item);
    const again = new AggregateError("an", "-", item);
    console.log("AggregateError, construct, form 11, does a second call answer the same thing:", result === again);
    console.log("AggregateError, construct, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 11, its own class:", Object.getPrototypeOf(result) === AggregateError.prototype, Reflect.getPrototypeOf(result) === AggregateError.prototype, result.constructor === AggregateError, Object.getPrototypeOf(result) === Object.getPrototypeOf(AggregateError.prototype));
    console.log("AggregateError, construct, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, construct, form 11: it threw", error instanceof Error);
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
    class Below extends AggregateError {
      mark = 1;
      constructor(p0, p1, p2) {
        super(p0, p1, p2);
        this.late = 2;
      }
    }
    const result = new Below("an", "-", item);
    console.log("AggregateError, construct, form 11, from a class below, is it an operand:", result === item);
    console.log("AggregateError, construct, form 11, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("AggregateError, construct, form 11, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 11, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 11, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 11, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 11, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 11, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 11, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 11, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AggregateError, construct, form 11, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AggregateError, construct, form 11, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("AggregateError, construct, form 11, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("AggregateError, construct, form 11, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("AggregateError, construct, form 11, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("AggregateError, construct, form 11, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(AggregateError, ["an", "-", item], Other);
    console.log("AggregateError, construct, form 11, for another new.target, is it an operand:", result === item);
    console.log("AggregateError, construct, form 11, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("AggregateError, construct, form 11, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AggregateError, construct, form 11, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AggregateError, construct, form 11, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AggregateError, construct, form 11, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AggregateError, construct, form 11, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AggregateError, construct, form 11, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AggregateError, construct, form 11, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Array(1);
    const again = Array(1);
    console.log("Array, does a second call answer the same thing:", result === again);
    console.log("Array:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, how many keys:", Object.keys(result).length);
    console.log("Array, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Array(1);
    const again = Array(1);
    console.log("Array, form 2, does a second call answer the same thing:", result === again);
    console.log("Array, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, form 2, how many keys:", Object.keys(result).length);
    console.log("Array, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Array(1.5, "an");
    const again = Array(1.5, "an");
    console.log("Array, form 3, does a second call answer the same thing:", result === again);
    console.log("Array, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Array("an", "an");
    const again = Array("an", "an");
    console.log("Array, form 4, does a second call answer the same thing:", result === again);
    console.log("Array, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, form 4, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, form 4, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, form 4, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, form 4, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, form 4: it threw", error instanceof Error);
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
    const result = Array(item, 1.5);
    console.log("Array, form 5, is it an operand:", result === item);
    const again = Array(item, 1.5);
    console.log("Array, form 5, does a second call answer the same thing:", result === again);
    console.log("Array, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, form 5, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, form 5, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, form 5, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, form 5, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, form 5, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, form 5, its length:", result.length === 0, result.length);
    console.log("Array, form 5[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, form 5[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Array, form 5[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Array, form 5[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Array, form 5[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    console.log("Array, form 5[0], how many keys:", Object.keys(result[0]).length);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, form 5[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, form 5[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Array, form 5[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Array, form 5[0].size:", typeof result[0].size === "undefined", typeof result[0].size === "boolean", typeof result[0].size === "number", typeof result[0].size === "string", typeof result[0].size === "bigint", typeof result[0].size === "symbol", typeof result[0].size === "function", typeof result[0].size === "object", result[0].size === null);
    console.log("Array, form 5[0].size, the number:", Number.isInteger(result[0].size), result[0].size === result[0].size, result[0].size < 0, result[0].size > 2147483647, result[0].size < -2147483648, Object.is(result[0].size, -0), (result[0].size | 0) === result[0].size);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, form 5, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, form 5, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Array(1);
    const again = new Array(1);
    console.log("Array, construct, form 6, does a second call answer the same thing:", result === again);
    console.log("Array, construct, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 6, how many keys:", Object.keys(result).length);
    console.log("Array, construct, form 6, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 6, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 6, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 6, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Array {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(1);
    console.log("Array, construct, form 6, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Array, construct, form 6, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 6, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 6, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 6, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 6, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 6, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 6, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 6, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 6, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 6, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Array, construct, form 6, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Array, construct, form 6, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Array, construct, form 6, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Array, construct, form 6, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 6, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 6, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 6, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 6, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Array, [1], Other);
    console.log("Array, construct, form 6, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Array, construct, form 6, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 6, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 6, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 6, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 6, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 6, for another new.target, how many keys:", Object.keys(result).length);
    console.log("Array, construct, form 6, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 6, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Array, construct, form 6, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Array(1.5, "an");
    const again = new Array(1.5, "an");
    console.log("Array, construct, form 9, does a second call answer the same thing:", result === again);
    console.log("Array, construct, form 9:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 9, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 9, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 9, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 9, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 9, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 9, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 9, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 9, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 9: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Array {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(1.5, "an");
    console.log("Array, construct, form 9, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Array, construct, form 9, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 9, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 9, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 9, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 9, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 9, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 9, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Array, construct, form 9, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Array, construct, form 9, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Array, construct, form 9, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Array, construct, form 9, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 9, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 9, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 9, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Array, [1.5, "an"], Other);
    console.log("Array, construct, form 9, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Array, construct, form 9, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 9, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 9, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 9, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 9, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 9, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 9, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 9, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 9, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Array, construct, form 9, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Array("an", "an");
    const again = new Array("an", "an");
    console.log("Array, construct, form 12, does a second call answer the same thing:", result === again);
    console.log("Array, construct, form 12:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 12, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 12, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 12, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 12, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 12, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 12, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 12, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 12, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 12: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Array {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", "an");
    console.log("Array, construct, form 12, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Array, construct, form 12, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 12, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 12, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 12, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 12, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 12, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 12, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Array, construct, form 12, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Array, construct, form 12, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Array, construct, form 12, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Array, construct, form 12, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 12, from a class below, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 12, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 12, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Array, ["an", "an"], Other);
    console.log("Array, construct, form 12, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Array, construct, form 12, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 12, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 12, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 12, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 12, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 12, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 12, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 12, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 12, for another new.target, its length:", result.length === 0, result.length);
  } catch (error) {
    console.log("Array, construct, form 12, for another new.target: it threw", error instanceof Error);
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
    const result = new Array(item, 1.5);
    console.log("Array, construct, form 15, is it an operand:", result === item);
    const again = new Array(item, 1.5);
    console.log("Array, construct, form 15, does a second call answer the same thing:", result === again);
    console.log("Array, construct, form 15:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 15, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 15, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 15, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 15, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 15, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 15, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 15, its length:", result.length === 0, result.length);
    console.log("Array, construct, form 15[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 15[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Array, construct, form 15[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Array, construct, form 15[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Array, construct, form 15[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    console.log("Array, construct, form 15[0], how many keys:", Object.keys(result[0]).length);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Array, construct, form 15[0].size:", typeof result[0].size === "undefined", typeof result[0].size === "boolean", typeof result[0].size === "number", typeof result[0].size === "string", typeof result[0].size === "bigint", typeof result[0].size === "symbol", typeof result[0].size === "function", typeof result[0].size === "object", result[0].size === null);
    console.log("Array, construct, form 15[0].size, the number:", Number.isInteger(result[0].size), result[0].size === result[0].size, result[0].size < 0, result[0].size > 2147483647, result[0].size < -2147483648, Object.is(result[0].size, -0), (result[0].size | 0) === result[0].size);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 15, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 15: it threw", error instanceof Error);
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
    class Below extends Array {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below(item, 1.5);
    console.log("Array, construct, form 15, from a class below, is it an operand:", result === item);
    console.log("Array, construct, form 15, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Array, construct, form 15, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 15, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 15, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 15, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 15, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 15, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 15, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Array, construct, form 15, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Array, construct, form 15, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Array, construct, form 15, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
    console.log("Array, construct, form 15, from a class below, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 15, from a class below, its length:", result.length === 0, result.length);
    console.log("Array, construct, form 15, from a class below[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 15, from a class below[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Array, construct, form 15, from a class below[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Array, construct, form 15, from a class below[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Array, construct, form 15, from a class below[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    console.log("Array, construct, form 15, from a class below[0], how many keys:", Object.keys(result[0]).length);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Array, construct, form 15, from a class below[0].size:", typeof result[0].size === "undefined", typeof result[0].size === "boolean", typeof result[0].size === "number", typeof result[0].size === "string", typeof result[0].size === "bigint", typeof result[0].size === "symbol", typeof result[0].size === "function", typeof result[0].size === "object", result[0].size === null);
    console.log("Array, construct, form 15, from a class below[0].size, the number:", Number.isInteger(result[0].size), result[0].size === result[0].size, result[0].size < 0, result[0].size > 2147483647, result[0].size < -2147483648, Object.is(result[0].size, -0), (result[0].size | 0) === result[0].size);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, from a class below, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Array, construct, form 15, from a class below, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Array, construct, form 15, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(Array, [item, 1.5], Other);
    console.log("Array, construct, form 15, for another new.target, is it an operand:", result === item);
    console.log("Array, construct, form 15, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Array, construct, form 15, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array, construct, form 15, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array, construct, form 15, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array, construct, form 15, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array, construct, form 15, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array, construct, form 15, for another new.target, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, for another new.target, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, for another new.target, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, for another new.target, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array, construct, form 15, for another new.target, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 15, for another new.target, its length:", result.length === 0, result.length);
    console.log("Array, construct, form 15, for another new.target[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Array, construct, form 15, for another new.target[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Array, construct, form 15, for another new.target[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Array, construct, form 15, for another new.target[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Array, construct, form 15, for another new.target[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    console.log("Array, construct, form 15, for another new.target[0], how many keys:", Object.keys(result[0]).length);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, for another new.target[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, for another new.target[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Array, construct, form 15, for another new.target[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Array, construct, form 15, for another new.target[0].size:", typeof result[0].size === "undefined", typeof result[0].size === "boolean", typeof result[0].size === "number", typeof result[0].size === "string", typeof result[0].size === "bigint", typeof result[0].size === "symbol", typeof result[0].size === "function", typeof result[0].size === "object", result[0].size === null);
    console.log("Array, construct, form 15, for another new.target[0].size, the number:", Number.isInteger(result[0].size), result[0].size === result[0].size, result[0].size < 0, result[0].size > 2147483647, result[0].size < -2147483648, Object.is(result[0].size, -0), (result[0].size | 0) === result[0].size);
  } catch (error) {
    console.log("Array, construct, form 15, for another new.target: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
