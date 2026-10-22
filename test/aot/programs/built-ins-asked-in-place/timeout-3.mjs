// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.unref.bind(subject)("an", "an");
    console.log("%Timeout%.prototype.unref, form 6, by a bound function, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.unref, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.unref, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.unref, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.unref, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.unref, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.unref, form 6, by a bound function: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = subject.unref(item, 1.5);
    console.log("%Timeout%.prototype.unref, form 11, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.unref, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.unref, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.unref, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.unref, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.unref, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.unref, form 11: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = subject.unref.call(subject, item, 1.5);
    console.log("%Timeout%.prototype.unref, form 11, by call, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.unref, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.unref, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.unref, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.unref, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.unref, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.unref, form 11, by call: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = subject.unref.apply(subject, [item, 1.5]);
    console.log("%Timeout%.prototype.unref, form 11, by apply, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.unref, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.unref, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.unref, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.unref, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.unref, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.unref, form 11, by apply: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = Reflect.apply(subject.unref, subject, [item, 1.5]);
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.unref, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = subject.unref.bind(subject)(item, 1.5);
    console.log("%Timeout%.prototype.unref, form 11, by a bound function, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.unref, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.unref, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.unref, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.unref, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.unref, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.unref, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject[Symbol.dispose](1.5, "an");
    console.log("%Timeout%.prototype[Symbol.dispose], is it an operand:", result === subject);
    console.log("%Timeout%.prototype[Symbol.dispose]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype[Symbol.dispose]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject[Symbol.dispose]("an", "an");
    console.log("%Timeout%.prototype[Symbol.dispose], form 2, is it an operand:", result === subject);
    console.log("%Timeout%.prototype[Symbol.dispose], form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype[Symbol.dispose], form 2: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = subject[Symbol.dispose](item, 1.5);
    console.log("%Timeout%.prototype[Symbol.dispose], form 3, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype[Symbol.dispose], form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype[Symbol.dispose], form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject[Symbol.toPrimitive](1.5, "an");
    console.log("%Timeout%.prototype[Symbol.toPrimitive], is it an operand:", result === subject);
    console.log("%Timeout%.prototype[Symbol.toPrimitive]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype[Symbol.toPrimitive]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject[Symbol.toPrimitive]("an", "an");
    console.log("%Timeout%.prototype[Symbol.toPrimitive], form 2, is it an operand:", result === subject);
    console.log("%Timeout%.prototype[Symbol.toPrimitive], form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype[Symbol.toPrimitive], form 2: it threw", error instanceof Error);
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
    const subject = setTimeout(() => {}, 0);
    const result = subject[Symbol.toPrimitive](item, 1.5);
    console.log("%Timeout%.prototype[Symbol.toPrimitive], form 3, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype[Symbol.toPrimitive], form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype[Symbol.toPrimitive], form 3: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
