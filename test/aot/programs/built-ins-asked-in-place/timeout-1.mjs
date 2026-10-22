// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject._destroyed;
    console.log("%Timeout%.prototype._destroyed, get, is it an operand:", result === subject);
    console.log("%Timeout%.prototype._destroyed, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype._destroyed, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject._idleStart;
    console.log("%Timeout%.prototype._idleStart, get, is it an operand:", result === subject);
    console.log("%Timeout%.prototype._idleStart, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype._idleStart, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject._idleTimeout;
    console.log("%Timeout%.prototype._idleTimeout, get, is it an operand:", result === subject);
    console.log("%Timeout%.prototype._idleTimeout, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype._idleTimeout, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close(1.5, "an");
    console.log("%Timeout%.prototype.close, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close.call(subject, 1.5, "an");
    console.log("%Timeout%.prototype.close, by call, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close.apply(subject, [1.5, "an"]);
    console.log("%Timeout%.prototype.close, by apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = Reflect.apply(subject.close, subject, [1.5, "an"]);
    console.log("%Timeout%.prototype.close, by Reflect.apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close.bind(subject)(1.5, "an");
    console.log("%Timeout%.prototype.close, by a bound function, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close("an", "an");
    console.log("%Timeout%.prototype.close, form 6, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close.call(subject, "an", "an");
    console.log("%Timeout%.prototype.close, form 6, by call, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close.apply(subject, ["an", "an"]);
    console.log("%Timeout%.prototype.close, form 6, by apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = Reflect.apply(subject.close, subject, ["an", "an"]);
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.close.bind(subject)("an", "an");
    console.log("%Timeout%.prototype.close, form 6, by a bound function, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.close, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 6, by a bound function: it threw", error instanceof Error);
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
    const result = subject.close(item, 1.5);
    console.log("%Timeout%.prototype.close, form 11, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.close, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 11: it threw", error instanceof Error);
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
    const result = subject.close.call(subject, item, 1.5);
    console.log("%Timeout%.prototype.close, form 11, by call, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.close, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 11, by call: it threw", error instanceof Error);
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
    const result = subject.close.apply(subject, [item, 1.5]);
    console.log("%Timeout%.prototype.close, form 11, by apply, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.close, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 11, by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(subject.close, subject, [item, 1.5]);
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const result = subject.close.bind(subject)(item, 1.5);
    console.log("%Timeout%.prototype.close, form 11, by a bound function, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.close, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.close, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.close, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.close, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.close, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.close, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.hasRef(1.5, "an");
    console.log("%Timeout%.prototype.hasRef, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.hasRef:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype.hasRef: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.hasRef("an", "an");
    console.log("%Timeout%.prototype.hasRef, form 2, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.hasRef, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype.hasRef, form 2: it threw", error instanceof Error);
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
    const result = subject.hasRef(item, 1.5);
    console.log("%Timeout%.prototype.hasRef, form 3, is it an operand:", result === subject, result === item);
    console.log("%Timeout%.prototype.hasRef, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%Timeout%.prototype.hasRef, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref(1.5, "an");
    console.log("%Timeout%.prototype.ref, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref.call(subject, 1.5, "an");
    console.log("%Timeout%.prototype.ref, by call, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref.apply(subject, [1.5, "an"]);
    console.log("%Timeout%.prototype.ref, by apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = Reflect.apply(subject.ref, subject, [1.5, "an"]);
    console.log("%Timeout%.prototype.ref, by Reflect.apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref.bind(subject)(1.5, "an");
    console.log("%Timeout%.prototype.ref, by a bound function, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref("an", "an");
    console.log("%Timeout%.prototype.ref, form 6, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref.call(subject, "an", "an");
    console.log("%Timeout%.prototype.ref, form 6, by call, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = subject.ref.apply(subject, ["an", "an"]);
    console.log("%Timeout%.prototype.ref, form 6, by apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = setTimeout(() => {}, 0);
    const result = Reflect.apply(subject.ref, subject, ["an", "an"]);
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply, is it an operand:", result === subject);
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
  } catch (error) {
    console.log("%Timeout%.prototype.ref, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
