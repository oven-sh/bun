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
    const result = subject[Symbol.asyncDispose]();
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], is it an operand:", result === subject);
    const again = subject[Symbol.asyncDispose]();
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], does a second call answer the same thing:", result === again);
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("%AsyncIterator%.prototype[Symbol.asyncDispose], settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
    }
  } catch (error) {
    console.log("%AsyncIterator%.prototype[Symbol.asyncDispose]: it threw", error instanceof Error);
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
    const result = subject[Symbol.asyncIterator]();
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], is it an operand:", result === subject);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator]: it threw", error instanceof Error);
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
    const result = subject[Symbol.asyncIterator].call(subject);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call, is it an operand:", result === subject);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by call: it threw", error instanceof Error);
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
    const result = subject[Symbol.asyncIterator].apply(subject, []);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply, is it an operand:", result === subject);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(subject[Symbol.asyncIterator], subject, []);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply, is it an operand:", result === subject);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by Reflect.apply: it threw", error instanceof Error);
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
    const result = subject[Symbol.asyncIterator].bind(subject)();
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function, is it an operand:", result === subject);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("%AsyncIterator%.prototype[Symbol.asyncIterator], by a bound function: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
