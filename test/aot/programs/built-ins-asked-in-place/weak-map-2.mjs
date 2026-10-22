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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    function callback() {
      return true;
    }
    const result = subject.getOrInsertComputed(item, callback);
    console.log("WeakMap.prototype.getOrInsertComputed, form 3, is it an operand:", result === subject, result === item, result === callback);
    console.log("WeakMap.prototype.getOrInsertComputed, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsertComputed, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsertComputed, form 3: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap();
    const first = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.getOrInsertComputed(first, callback);
    console.log("WeakMap.prototype.getOrInsertComputed, form 4, is it an operand:", result === subject, result === first, result === callback);
    console.log("WeakMap.prototype.getOrInsertComputed, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.getOrInsertComputed, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.getOrInsertComputed, form 4: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.has(key);
    console.log("WeakMap.prototype.has, is it an operand:", result === subject);
    console.log("WeakMap.prototype.has:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.has, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.has: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.has(1.5);
    console.log("WeakMap.prototype.has, form 2, is it an operand:", result === subject);
    console.log("WeakMap.prototype.has, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.has, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.has, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject.has(key);
    console.log("WeakMap.prototype.has, form 3, is it an operand:", result === subject);
    console.log("WeakMap.prototype.has, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.has, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakMap.prototype.has, form 3: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set(first, 2.5);
    console.log("WeakMap.prototype.set, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set.call(subject, first, 2.5);
    console.log("WeakMap.prototype.set, by call, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, by call, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set.apply(subject, [first, 2.5]);
    console.log("WeakMap.prototype.set, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, by apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(subject.set, subject, [first, 2.5]);
    console.log("WeakMap.prototype.set, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set.bind(subject)(first, 2.5);
    console.log("WeakMap.prototype.set, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = [1.5, item, "two"];
    const result = subject.set(first, 2.5);
    console.log("WeakMap.prototype.set, form 6, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 6, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 6: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = [1.5, item, "two"];
    const result = subject.set.call(subject, first, 2.5);
    console.log("WeakMap.prototype.set, form 6, by call, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 6, by call, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 6, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 6, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = [1.5, item, "two"];
    const result = subject.set.apply(subject, [first, 2.5]);
    console.log("WeakMap.prototype.set, form 6, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 6, by apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 6, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 6, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = [1.5, item, "two"];
    const result = Reflect.apply(subject.set, subject, [first, 2.5]);
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const first = [1.5, item, "two"];
    const result = subject.set.bind(subject)(first, 2.5);
    console.log("WeakMap.prototype.set, form 6, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 6, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 6, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 6, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.set(item, item);
    console.log("WeakMap.prototype.set, form 11, is it an operand:", result === subject, result === item, result === item);
    console.log("WeakMap.prototype.set, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 11, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 11: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.set.call(subject, item, item);
    console.log("WeakMap.prototype.set, form 11, by call, is it an operand:", result === subject, result === item, result === item);
    console.log("WeakMap.prototype.set, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 11, by call, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 11, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 11, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.set.apply(subject, [item, item]);
    console.log("WeakMap.prototype.set, form 11, by apply, is it an operand:", result === subject, result === item, result === item);
    console.log("WeakMap.prototype.set, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 11, by apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 11, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 11, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = Reflect.apply(subject.set, subject, [item, item]);
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, is it an operand:", result === subject, result === item, result === item);
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject.set.bind(subject)(item, item);
    console.log("WeakMap.prototype.set, form 11, by a bound function, is it an operand:", result === subject, result === item, result === item);
    console.log("WeakMap.prototype.set, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 11, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 11, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 11, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set(first, 2.5);
    console.log("WeakMap.prototype.set, form 16, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 16, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 16, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 16, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 16, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 16, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 16, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 16: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set.call(subject, first, 2.5);
    console.log("WeakMap.prototype.set, form 16, by call, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 16, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 16, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 16, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 16, by call, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 16, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 16, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 16, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 16, by call: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set.apply(subject, [first, 2.5]);
    console.log("WeakMap.prototype.set, form 16, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 16, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 16, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 16, by apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 16, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 16, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 16, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 16, by apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap();
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(subject.set, subject, [first, 2.5]);
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 16, by Reflect.apply: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.set.bind(subject)(first, 2.5);
    console.log("WeakMap.prototype.set, form 16, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakMap.prototype.set, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype.set, form 16, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakMap.prototype.set, form 16, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakMap.prototype.set, form 16, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakMap.prototype, Reflect.getPrototypeOf(result) === WeakMap.prototype, result.constructor === WeakMap, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakMap.prototype));
    console.log("WeakMap.prototype.set, form 16, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakMap.prototype.set, form 16, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakMap.prototype.set, form 16, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakMap.prototype.set, form 16, by a bound function: it threw", error instanceof Error);
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
    const key = { name: 1 };
    const subject = new WeakMap([[key, item]]);
    const result = subject[Symbol.toStringTag];
    console.log("WeakMap.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("WeakMap.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakMap.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakMap();
    const result = subject[Symbol.toStringTag];
    console.log("WeakMap.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("WeakMap.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakMap.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakMap.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
