// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = new Date("an");
    const again = new Date("an");
    console.log("Date, construct, form 9, does a second call answer the same thing:", result === again);
    console.log("Date, construct, form 9:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 9, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 9, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 9, its own class:", Object.getPrototypeOf(result) === Date.prototype, Reflect.getPrototypeOf(result) === Date.prototype, result.constructor === Date, Object.getPrototypeOf(result) === Object.getPrototypeOf(Date.prototype));
    console.log("Date, construct, form 9, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 9, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 9: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Date {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below("an");
    console.log("Date, construct, form 9, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Date, construct, form 9, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 9, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 9, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 9, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 9, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 9, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 9, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 9, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Date, construct, form 9, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Date, construct, form 9, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
  } catch (error) {
    console.log("Date, construct, form 9, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Date, ["an"], Other);
    console.log("Date, construct, form 9, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Date, construct, form 9, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 9, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 9, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 9, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 9, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 9, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Date(86400000.5);
    const result = new Date(first);
    console.log("Date, construct, form 12, is it an operand:", result === first);
    const again = new Date(first);
    console.log("Date, construct, form 12, does a second call answer the same thing:", result === again);
    console.log("Date, construct, form 12:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 12, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 12, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 12, its own class:", Object.getPrototypeOf(result) === Date.prototype, Reflect.getPrototypeOf(result) === Date.prototype, result.constructor === Date, Object.getPrototypeOf(result) === Object.getPrototypeOf(Date.prototype));
    console.log("Date, construct, form 12, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 12, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 12: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Date(86400000.5);
    class Below extends Date {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(first);
    console.log("Date, construct, form 12, from a class below, is it an operand:", result === first);
    console.log("Date, construct, form 12, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Date, construct, form 12, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 12, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 12, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 12, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 12, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 12, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 12, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 12, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Date, construct, form 12, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Date, construct, form 12, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
  } catch (error) {
    console.log("Date, construct, form 12, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Date(86400000.5);
    function Other() {}
    const result = Reflect.construct(Date, [first], Other);
    console.log("Date, construct, form 12, for another new.target, is it an operand:", result === first);
    console.log("Date, construct, form 12, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Date, construct, form 12, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 12, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 12, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 12, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 12, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 12, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Date(null);
    const again = new Date(null);
    console.log("Date, construct, form 15, does a second call answer the same thing:", result === again);
    console.log("Date, construct, form 15:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 15, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 15, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 15, its own class:", Object.getPrototypeOf(result) === Date.prototype, Reflect.getPrototypeOf(result) === Date.prototype, result.constructor === Date, Object.getPrototypeOf(result) === Object.getPrototypeOf(Date.prototype));
    console.log("Date, construct, form 15, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 15, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 15: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Date {
      mark = 1;
      constructor(p0) {
        super(p0);
        this.late = 2;
      }
    }
    const result = new Below(null);
    console.log("Date, construct, form 15, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Date, construct, form 15, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 15, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 15, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 15, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 15, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 15, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 15, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 15, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Date, construct, form 15, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Date, construct, form 15, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
  } catch (error) {
    console.log("Date, construct, form 15, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Date, [null], Other);
    console.log("Date, construct, form 15, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Date, construct, form 15, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 15, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 15, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 15, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 15, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 15, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Date(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5);
    const again = new Date(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5);
    console.log("Date, construct, form 18, does a second call answer the same thing:", result === again);
    console.log("Date, construct, form 18:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 18, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 18, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 18, its own class:", Object.getPrototypeOf(result) === Date.prototype, Reflect.getPrototypeOf(result) === Date.prototype, result.constructor === Date, Object.getPrototypeOf(result) === Object.getPrototypeOf(Date.prototype));
    console.log("Date, construct, form 18, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 18, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 18: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Date {
      mark = 1;
      constructor(p0, p1, p2, p3, p4, p5, p6) {
        super(p0, p1, p2, p3, p4, p5, p6);
        this.late = 2;
      }
    }
    const result = new Below(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5);
    console.log("Date, construct, form 18, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Date, construct, form 18, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 18, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 18, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 18, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 18, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 18, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 18, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Date, construct, form 18, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Date, construct, form 18, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Date, construct, form 18, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
  } catch (error) {
    console.log("Date, construct, form 18, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Date, [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], Other);
    console.log("Date, construct, form 18, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Date, construct, form 18, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date, construct, form 18, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date, construct, form 18, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date, construct, form 18, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date, construct, form 18, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("Date, construct, form 18, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new DisposableStack();
    const again = new DisposableStack();
    console.log("DisposableStack, construct, does a second call answer the same thing:", result === again);
    console.log("DisposableStack, construct:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack, construct, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("DisposableStack, construct, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("DisposableStack, construct, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("DisposableStack, construct, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("DisposableStack, construct, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("DisposableStack, construct: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends DisposableStack {
      mark = 1;
      constructor() {
        super();
        this.late = 2;
      }
    }
    const result = new Below();
    console.log("DisposableStack, construct, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("DisposableStack, construct, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack, construct, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("DisposableStack, construct, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("DisposableStack, construct, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("DisposableStack, construct, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("DisposableStack, construct, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("DisposableStack, construct, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("DisposableStack, construct, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("DisposableStack, construct, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("DisposableStack, construct, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("DisposableStack, construct, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("DisposableStack, construct, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("DisposableStack, construct, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("DisposableStack, construct, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(DisposableStack, [], Other);
    console.log("DisposableStack, construct, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("DisposableStack, construct, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack, construct, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("DisposableStack, construct, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("DisposableStack, construct, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("DisposableStack, construct, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("DisposableStack, construct, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("DisposableStack, construct, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error("an", 2.5);
    const again = Error("an", 2.5);
    console.log("Error, does a second call answer the same thing:", result === again);
    console.log("Error:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error("an", "-");
    const again = Error("an", "-");
    console.log("Error, form 2, does a second call answer the same thing:", result === again);
    console.log("Error, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, form 2, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, form 2: it threw", error instanceof Error);
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
    const result = Error("an", item);
    console.log("Error, form 3, is it an operand:", result === item);
    const again = Error("an", item);
    console.log("Error, form 3, does a second call answer the same thing:", result === again);
    console.log("Error, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, form 3, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error("an", 2.5);
    const again = Error("an", 2.5);
    console.log("Error, form 4, does a second call answer the same thing:", result === again);
    console.log("Error, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, form 4, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Error("an", 2.5);
    const again = new Error("an", 2.5);
    console.log("Error, construct, form 5, does a second call answer the same thing:", result === again);
    console.log("Error, construct, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 5, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, construct, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, construct, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Error {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", 2.5);
    console.log("Error, construct, form 5, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Error, construct, form 5, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 5, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 5, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 5, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 5, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 5, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 5, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 5, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 5, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Error, construct, form 5, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Error, construct, form 5, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Error, construct, form 5, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Error, construct, form 5, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("Error, construct, form 5, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Error, ["an", 2.5], Other);
    console.log("Error, construct, form 5, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Error, construct, form 5, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 5, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 5, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 5, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 5, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 5, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, construct, form 5, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = new Error("an", "-");
    const again = new Error("an", "-");
    console.log("Error, construct, form 8, does a second call answer the same thing:", result === again);
    console.log("Error, construct, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 8, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, construct, form 8, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, construct, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Below extends Error {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", "-");
    console.log("Error, construct, form 8, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Error, construct, form 8, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 8, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 8, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 8, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 8, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 8, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 8, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 8, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 8, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Error, construct, form 8, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Error, construct, form 8, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Error, construct, form 8, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Error, construct, form 8, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("Error, construct, form 8, from a class below: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function Other() {}
    const result = Reflect.construct(Error, ["an", "-"], Other);
    console.log("Error, construct, form 8, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Error, construct, form 8, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 8, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 8, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 8, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 8, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 8, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, construct, form 8, for another new.target: it threw", error instanceof Error);
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
    const result = new Error("an", item);
    console.log("Error, construct, form 11, is it an operand:", result === item);
    const again = new Error("an", item);
    console.log("Error, construct, form 11, does a second call answer the same thing:", result === again);
    console.log("Error, construct, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 11, its own class:", Object.getPrototypeOf(result) === Error.prototype, Reflect.getPrototypeOf(result) === Error.prototype, result.constructor === Error, Object.getPrototypeOf(result) === Object.getPrototypeOf(Error.prototype));
    console.log("Error, construct, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, construct, form 11: it threw", error instanceof Error);
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
    class Below extends Error {
      mark = 1;
      constructor(p0, p1) {
        super(p0, p1);
        this.late = 2;
      }
    }
    const result = new Below("an", item);
    console.log("Error, construct, form 11, from a class below, is it an operand:", result === item);
    console.log("Error, construct, form 11, from a class below, the class:", result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");
    console.log("Error, construct, form 11, from a class below:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 11, from a class below, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 11, from a class below, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 11, from a class below, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 11, from a class below, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 11, from a class below, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 11, from a class below, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 11, from a class below, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Error, construct, form 11, from a class below, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Error, construct, form 11, from a class below.mark:", typeof result.mark === "undefined", typeof result.mark === "boolean", typeof result.mark === "number", typeof result.mark === "string", typeof result.mark === "bigint", typeof result.mark === "symbol", typeof result.mark === "function", typeof result.mark === "object", result.mark === null);
    console.log("Error, construct, form 11, from a class below.mark, the number:", Number.isInteger(result.mark), result.mark === result.mark, result.mark < 0, result.mark > 2147483647, result.mark < -2147483648, Object.is(result.mark, -0), (result.mark | 0) === result.mark);
    console.log("Error, construct, form 11, from a class below.late:", typeof result.late === "undefined", typeof result.late === "boolean", typeof result.late === "number", typeof result.late === "string", typeof result.late === "bigint", typeof result.late === "symbol", typeof result.late === "function", typeof result.late === "object", result.late === null);
    console.log("Error, construct, form 11, from a class below.late, the number:", Number.isInteger(result.late), result.late === result.late, result.late < 0, result.late > 2147483647, result.late < -2147483648, Object.is(result.late, -0), (result.late | 0) === result.late);
  } catch (error) {
    console.log("Error, construct, form 11, from a class below: it threw", error instanceof Error);
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
    const result = Reflect.construct(Error, ["an", item], Other);
    console.log("Error, construct, form 11, for another new.target, is it an operand:", result === item);
    console.log("Error, construct, form 11, for another new.target, the class:", result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);
    console.log("Error, construct, form 11, for another new.target:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error, construct, form 11, for another new.target, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Error, construct, form 11, for another new.target, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Error, construct, form 11, for another new.target, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Error, construct, form 11, for another new.target, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Error, construct, form 11, for another new.target, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Error, construct, form 11, for another new.target: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = EvalError("an", 2.5);
    const again = EvalError("an", 2.5);
    console.log("EvalError, does a second call answer the same thing:", result === again);
    console.log("EvalError:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("EvalError, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("EvalError, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("EvalError, its own class:", Object.getPrototypeOf(result) === EvalError.prototype, Reflect.getPrototypeOf(result) === EvalError.prototype, result.constructor === EvalError, Object.getPrototypeOf(result) === Object.getPrototypeOf(EvalError.prototype));
    console.log("EvalError, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("EvalError, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("EvalError, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("EvalError: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = EvalError("an", "-");
    const again = EvalError("an", "-");
    console.log("EvalError, form 2, does a second call answer the same thing:", result === again);
    console.log("EvalError, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("EvalError, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("EvalError, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("EvalError, form 2, its own class:", Object.getPrototypeOf(result) === EvalError.prototype, Reflect.getPrototypeOf(result) === EvalError.prototype, result.constructor === EvalError, Object.getPrototypeOf(result) === Object.getPrototypeOf(EvalError.prototype));
    console.log("EvalError, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("EvalError, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("EvalError, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("EvalError, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
