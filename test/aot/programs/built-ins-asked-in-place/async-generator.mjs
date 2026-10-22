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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.next(1.5);
    console.log("%AsyncGenerator%.prototype.next, is it an operand:", result === subject);
    const again = subject.next(1.5);
    console.log("%AsyncGenerator%.prototype.next, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.next:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.next, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.next, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.next, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.next, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.next, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.next, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncGenerator%.prototype.next, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("%AsyncGenerator%.prototype.next, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("%AsyncGenerator%.prototype.next, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("%AsyncGenerator%.prototype.next, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("%AsyncGenerator%.prototype.next, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("%AsyncGenerator%.prototype.next, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("%AsyncGenerator%.prototype.next, settled.value:", typeof settled.value === "undefined", typeof settled.value === "boolean", typeof settled.value === "number", typeof settled.value === "string", typeof settled.value === "bigint", typeof settled.value === "symbol", typeof settled.value === "function", typeof settled.value === "object", settled.value === null);
      console.log("%AsyncGenerator%.prototype.next, settled.value, the number:", Number.isInteger(settled.value), settled.value === settled.value, settled.value < 0, settled.value > 2147483647, settled.value < -2147483648, Object.is(settled.value, -0), (settled.value | 0) === settled.value);
      console.log("%AsyncGenerator%.prototype.next, settled.done:", typeof settled.done === "undefined", typeof settled.done === "boolean", typeof settled.done === "number", typeof settled.done === "string", typeof settled.done === "bigint", typeof settled.done === "symbol", typeof settled.done === "function", typeof settled.done === "object", settled.done === null);
      console.log("%AsyncGenerator%.prototype.next, settled.done, the boolean:", settled.done === true, settled.done === false, !settled.done);
    }
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.next: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.next("an");
    console.log("%AsyncGenerator%.prototype.next, form 2, is it an operand:", result === subject);
    const again = subject.next("an");
    console.log("%AsyncGenerator%.prototype.next, form 2, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.next, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.next, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.next, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.next, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.next, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.next, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.next, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncGenerator%.prototype.next, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("%AsyncGenerator%.prototype.next, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("%AsyncGenerator%.prototype.next, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("%AsyncGenerator%.prototype.next, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("%AsyncGenerator%.prototype.next, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("%AsyncGenerator%.prototype.next, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("%AsyncGenerator%.prototype.next, form 2, settled.value:", typeof settled.value === "undefined", typeof settled.value === "boolean", typeof settled.value === "number", typeof settled.value === "string", typeof settled.value === "bigint", typeof settled.value === "symbol", typeof settled.value === "function", typeof settled.value === "object", settled.value === null);
      console.log("%AsyncGenerator%.prototype.next, form 2, settled.value, the number:", Number.isInteger(settled.value), settled.value === settled.value, settled.value < 0, settled.value > 2147483647, settled.value < -2147483648, Object.is(settled.value, -0), (settled.value | 0) === settled.value);
      console.log("%AsyncGenerator%.prototype.next, form 2, settled.done:", typeof settled.done === "undefined", typeof settled.done === "boolean", typeof settled.done === "number", typeof settled.done === "string", typeof settled.done === "bigint", typeof settled.done === "symbol", typeof settled.done === "function", typeof settled.done === "object", settled.done === null);
      console.log("%AsyncGenerator%.prototype.next, form 2, settled.done, the boolean:", settled.done === true, settled.done === false, !settled.done);
    }
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.next, form 2: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.next(item);
    console.log("%AsyncGenerator%.prototype.next, form 3, is it an operand:", result === subject, result === item);
    const again = subject.next(item);
    console.log("%AsyncGenerator%.prototype.next, form 3, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.next, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.next, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.next, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.next, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.next, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.next, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.next, form 3, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncGenerator%.prototype.next, form 3, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("%AsyncGenerator%.prototype.next, form 3, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("%AsyncGenerator%.prototype.next, form 3, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("%AsyncGenerator%.prototype.next, form 3, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("%AsyncGenerator%.prototype.next, form 3, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("%AsyncGenerator%.prototype.next, form 3, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, form 3, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, form 3, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.next, form 3, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("%AsyncGenerator%.prototype.next, form 3, settled.value:", typeof settled.value === "undefined", typeof settled.value === "boolean", typeof settled.value === "number", typeof settled.value === "string", typeof settled.value === "bigint", typeof settled.value === "symbol", typeof settled.value === "function", typeof settled.value === "object", settled.value === null);
      console.log("%AsyncGenerator%.prototype.next, form 3, settled.value, the number:", Number.isInteger(settled.value), settled.value === settled.value, settled.value < 0, settled.value > 2147483647, settled.value < -2147483648, Object.is(settled.value, -0), (settled.value | 0) === settled.value);
      console.log("%AsyncGenerator%.prototype.next, form 3, settled.done:", typeof settled.done === "undefined", typeof settled.done === "boolean", typeof settled.done === "number", typeof settled.done === "string", typeof settled.done === "bigint", typeof settled.done === "symbol", typeof settled.done === "function", typeof settled.done === "object", settled.done === null);
      console.log("%AsyncGenerator%.prototype.next, form 3, settled.done, the boolean:", settled.done === true, settled.done === false, !settled.done);
    }
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.next, form 3: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.return(1.5);
    console.log("%AsyncGenerator%.prototype.return, is it an operand:", result === subject);
    const again = subject.return(1.5);
    console.log("%AsyncGenerator%.prototype.return, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.return:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.return, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.return, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.return, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.return, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.return, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.return, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncGenerator%.prototype.return, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("%AsyncGenerator%.prototype.return, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("%AsyncGenerator%.prototype.return, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("%AsyncGenerator%.prototype.return, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("%AsyncGenerator%.prototype.return, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("%AsyncGenerator%.prototype.return, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("%AsyncGenerator%.prototype.return, settled.value:", typeof settled.value === "undefined", typeof settled.value === "boolean", typeof settled.value === "number", typeof settled.value === "string", typeof settled.value === "bigint", typeof settled.value === "symbol", typeof settled.value === "function", typeof settled.value === "object", settled.value === null);
      console.log("%AsyncGenerator%.prototype.return, settled.value, the number:", Number.isInteger(settled.value), settled.value === settled.value, settled.value < 0, settled.value > 2147483647, settled.value < -2147483648, Object.is(settled.value, -0), (settled.value | 0) === settled.value);
      console.log("%AsyncGenerator%.prototype.return, settled.done:", typeof settled.done === "undefined", typeof settled.done === "boolean", typeof settled.done === "number", typeof settled.done === "string", typeof settled.done === "bigint", typeof settled.done === "symbol", typeof settled.done === "function", typeof settled.done === "object", settled.done === null);
      console.log("%AsyncGenerator%.prototype.return, settled.done, the boolean:", settled.done === true, settled.done === false, !settled.done);
    }
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.return: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.return("an");
    console.log("%AsyncGenerator%.prototype.return, form 2, is it an operand:", result === subject);
    const again = subject.return("an");
    console.log("%AsyncGenerator%.prototype.return, form 2, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.return, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.return, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.return, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.return, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.return, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.return, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.return, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncGenerator%.prototype.return, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("%AsyncGenerator%.prototype.return, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("%AsyncGenerator%.prototype.return, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("%AsyncGenerator%.prototype.return, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("%AsyncGenerator%.prototype.return, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("%AsyncGenerator%.prototype.return, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("%AsyncGenerator%.prototype.return, form 2, settled.value:", typeof settled.value === "undefined", typeof settled.value === "boolean", typeof settled.value === "number", typeof settled.value === "string", typeof settled.value === "bigint", typeof settled.value === "symbol", typeof settled.value === "function", typeof settled.value === "object", settled.value === null);
      console.log("%AsyncGenerator%.prototype.return, form 2, settled.value, the text:", settled.value.length === 0, settled.value === "");
      console.log("%AsyncGenerator%.prototype.return, form 2, settled.done:", typeof settled.done === "undefined", typeof settled.done === "boolean", typeof settled.done === "number", typeof settled.done === "string", typeof settled.done === "bigint", typeof settled.done === "symbol", typeof settled.done === "function", typeof settled.done === "object", settled.done === null);
      console.log("%AsyncGenerator%.prototype.return, form 2, settled.done, the boolean:", settled.done === true, settled.done === false, !settled.done);
    }
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.return, form 2: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.return(item);
    console.log("%AsyncGenerator%.prototype.return, form 3, is it an operand:", result === subject, result === item);
    const again = subject.return(item);
    console.log("%AsyncGenerator%.prototype.return, form 3, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.return, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.return, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.return, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.return, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.return, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.return, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.return, form 3, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncGenerator%.prototype.return, form 3, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("%AsyncGenerator%.prototype.return, form 3, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("%AsyncGenerator%.prototype.return, form 3, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, form 3, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, form 3, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("%AsyncGenerator%.prototype.return, form 3, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.value:", typeof settled.value === "undefined", typeof settled.value === "boolean", typeof settled.value === "number", typeof settled.value === "string", typeof settled.value === "bigint", typeof settled.value === "symbol", typeof settled.value === "function", typeof settled.value === "object", settled.value === null);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.value, the class:", Array.isArray(settled.value), settled.value instanceof Object, settled.value instanceof Array, settled.value instanceof Map, settled.value instanceof Set, settled.value instanceof Promise, settled.value instanceof Date, settled.value instanceof RegExp, settled.value instanceof Error, settled.value instanceof ArrayBuffer, settled.value instanceof Uint8Array, settled.value instanceof Function, ArrayBuffer.isView(settled.value));
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.value, above it:", Object.getPrototypeOf(settled.value) === Object.prototype, Object.getPrototypeOf(settled.value) === Array.prototype, Object.getPrototypeOf(settled.value) === null);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.value, its state:", Object.isFrozen(settled.value), Object.isSealed(settled.value), Object.isExtensible(settled.value));
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.value, names in it:", "length" in settled.value, "size" in settled.value, "then" in settled.value, "next" in settled.value, "constructor" in settled.value, Symbol.iterator in settled.value);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.done:", typeof settled.done === "undefined", typeof settled.done === "boolean", typeof settled.done === "number", typeof settled.done === "string", typeof settled.done === "bigint", typeof settled.done === "symbol", typeof settled.done === "function", typeof settled.done === "object", settled.done === null);
      console.log("%AsyncGenerator%.prototype.return, form 3, settled.done, the boolean:", settled.done === true, settled.done === false, !settled.done);
    }
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.return, form 3: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.throw(1.5);
    console.log("%AsyncGenerator%.prototype.throw, is it an operand:", result === subject);
    const again = subject.throw(1.5);
    console.log("%AsyncGenerator%.prototype.throw, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.throw:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.throw, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.throw, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.throw, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.throw, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.throw, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.throw, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.throw: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.throw("an");
    console.log("%AsyncGenerator%.prototype.throw, form 2, is it an operand:", result === subject);
    const again = subject.throw("an");
    console.log("%AsyncGenerator%.prototype.throw, form 2, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.throw, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.throw, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.throw, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.throw, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.throw, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.throw, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.throw, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.throw, form 2: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.throw(item);
    console.log("%AsyncGenerator%.prototype.throw, form 3, is it an operand:", result === subject, result === item);
    const again = subject.throw(item);
    console.log("%AsyncGenerator%.prototype.throw, form 3, does a second call answer the same thing:", result === again);
    console.log("%AsyncGenerator%.prototype.throw, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype.throw, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncGenerator%.prototype.throw, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncGenerator%.prototype.throw, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncGenerator%.prototype.throw, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncGenerator%.prototype.throw, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncGenerator%.prototype.throw, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncGenerator%.prototype.throw, form 3: it threw", error instanceof Error);
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
    async function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject[Symbol.toStringTag];
    console.log("%AsyncGenerator%.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("%AsyncGenerator%.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncGenerator%.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%AsyncGenerator%.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
