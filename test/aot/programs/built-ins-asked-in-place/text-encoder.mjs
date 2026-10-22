// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new TextEncoder();
    const result = subject.encode("an");
    console.log("TextEncoder.prototype.encode, is it an operand:", result === subject);
    const again = subject.encode("an");
    console.log("TextEncoder.prototype.encode, does a second call answer the same thing:", result === again);
    console.log("TextEncoder.prototype.encode:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encode, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("TextEncoder.prototype.encode, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("TextEncoder.prototype.encode, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("TextEncoder.prototype.encode, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("TextEncoder.prototype.encode, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("TextEncoder.prototype.encode, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("TextEncoder.prototype.encode, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("TextEncoder.prototype.encode, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("TextEncoder.prototype.encode, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("TextEncoder.prototype.encode: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextEncoder();
    const result = subject.encode(1.5);
    console.log("TextEncoder.prototype.encode, form 2, is it an operand:", result === subject);
    const again = subject.encode(1.5);
    console.log("TextEncoder.prototype.encode, form 2, does a second call answer the same thing:", result === again);
    console.log("TextEncoder.prototype.encode, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encode, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("TextEncoder.prototype.encode, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("TextEncoder.prototype.encode, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("TextEncoder.prototype.encode, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("TextEncoder.prototype.encode, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("TextEncoder.prototype.encode, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("TextEncoder.prototype.encode, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("TextEncoder.prototype.encode, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("TextEncoder.prototype.encode, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("TextEncoder.prototype.encode, form 2: it threw", error instanceof Error);
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
    const subject = new TextEncoder();
    const result = subject.encode(item);
    console.log("TextEncoder.prototype.encode, form 3, is it an operand:", result === subject, result === item);
    const again = subject.encode(item);
    console.log("TextEncoder.prototype.encode, form 3, does a second call answer the same thing:", result === again);
    console.log("TextEncoder.prototype.encode, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encode, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("TextEncoder.prototype.encode, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("TextEncoder.prototype.encode, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("TextEncoder.prototype.encode, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("TextEncoder.prototype.encode, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("TextEncoder.prototype.encode, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("TextEncoder.prototype.encode, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("TextEncoder.prototype.encode, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encode, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("TextEncoder.prototype.encode, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("TextEncoder.prototype.encode, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextEncoder();
    const second = new DataView(new ArrayBuffer(16));
    const result = subject.encodeInto("an", second);
    console.log("TextEncoder.prototype.encodeInto, is it an operand:", result === subject, result === second);
    const again = subject.encodeInto("an", second);
    console.log("TextEncoder.prototype.encodeInto, does a second call answer the same thing:", result === again);
    console.log("TextEncoder.prototype.encodeInto:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encodeInto, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("TextEncoder.prototype.encodeInto, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("TextEncoder.prototype.encodeInto, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("TextEncoder.prototype.encodeInto, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("TextEncoder.prototype.encodeInto, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("TextEncoder.prototype.encodeInto.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("TextEncoder.prototype.encodeInto.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("TextEncoder.prototype.encodeInto.written:", typeof result.written === "undefined", typeof result.written === "boolean", typeof result.written === "number", typeof result.written === "string", typeof result.written === "bigint", typeof result.written === "symbol", typeof result.written === "function", typeof result.written === "object", result.written === null);
    console.log("TextEncoder.prototype.encodeInto.written, the number:", Number.isInteger(result.written), result.written === result.written, result.written < 0, result.written > 2147483647, result.written < -2147483648, Object.is(result.written, -0), (result.written | 0) === result.written);
  } catch (error) {
    console.log("TextEncoder.prototype.encodeInto: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextEncoder();
    const second = new DataView(new ArrayBuffer(16));
    const result = subject.encodeInto(1.5, second);
    console.log("TextEncoder.prototype.encodeInto, form 2, is it an operand:", result === subject, result === second);
    const again = subject.encodeInto(1.5, second);
    console.log("TextEncoder.prototype.encodeInto, form 2, does a second call answer the same thing:", result === again);
    console.log("TextEncoder.prototype.encodeInto, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encodeInto, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("TextEncoder.prototype.encodeInto, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("TextEncoder.prototype.encodeInto, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("TextEncoder.prototype.encodeInto, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("TextEncoder.prototype.encodeInto, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("TextEncoder.prototype.encodeInto, form 2.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("TextEncoder.prototype.encodeInto, form 2.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("TextEncoder.prototype.encodeInto, form 2.written:", typeof result.written === "undefined", typeof result.written === "boolean", typeof result.written === "number", typeof result.written === "string", typeof result.written === "bigint", typeof result.written === "symbol", typeof result.written === "function", typeof result.written === "object", result.written === null);
    console.log("TextEncoder.prototype.encodeInto, form 2.written, the number:", Number.isInteger(result.written), result.written === result.written, result.written < 0, result.written > 2147483647, result.written < -2147483648, Object.is(result.written, -0), (result.written | 0) === result.written);
  } catch (error) {
    console.log("TextEncoder.prototype.encodeInto, form 2: it threw", error instanceof Error);
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
    const subject = new TextEncoder();
    const second = new DataView(new ArrayBuffer(16));
    const result = subject.encodeInto(item, second);
    console.log("TextEncoder.prototype.encodeInto, form 3, is it an operand:", result === subject, result === item, result === second);
    const again = subject.encodeInto(item, second);
    console.log("TextEncoder.prototype.encodeInto, form 3, does a second call answer the same thing:", result === again);
    console.log("TextEncoder.prototype.encodeInto, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encodeInto, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("TextEncoder.prototype.encodeInto, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("TextEncoder.prototype.encodeInto, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("TextEncoder.prototype.encodeInto, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("TextEncoder.prototype.encodeInto, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("TextEncoder.prototype.encodeInto, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("TextEncoder.prototype.encodeInto, form 3.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("TextEncoder.prototype.encodeInto, form 3.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("TextEncoder.prototype.encodeInto, form 3.written:", typeof result.written === "undefined", typeof result.written === "boolean", typeof result.written === "number", typeof result.written === "string", typeof result.written === "bigint", typeof result.written === "symbol", typeof result.written === "function", typeof result.written === "object", result.written === null);
    console.log("TextEncoder.prototype.encodeInto, form 3.written, the number:", Number.isInteger(result.written), result.written === result.written, result.written < 0, result.written > 2147483647, result.written < -2147483648, Object.is(result.written, -0), (result.written | 0) === result.written);
  } catch (error) {
    console.log("TextEncoder.prototype.encodeInto, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new TextEncoder();
    const result = subject.encoding;
    console.log("TextEncoder.prototype.encoding, get, is it an operand:", result === subject);
    console.log("TextEncoder.prototype.encoding, get, is it a text that its row names:", result === "utf-8");
    console.log("TextEncoder.prototype.encoding, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("TextEncoder.prototype.encoding, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("TextEncoder.prototype.encoding, get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
