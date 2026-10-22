// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = WeakSet.length;
    console.log("WeakSet.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("WeakSet.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("WeakSet.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = WeakSet.name;
    console.log("WeakSet.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakSet.name, get: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add(first);
    console.log("WeakSet.prototype.add, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add.call(subject, first);
    console.log("WeakSet.prototype.add, by call, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, by call, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, by call: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add.apply(subject, [first]);
    console.log("WeakSet.prototype.add, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, by apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, by apply: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(subject.add, subject, [first]);
    console.log("WeakSet.prototype.add, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add.bind(subject)(first);
    console.log("WeakSet.prototype.add, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, by a bound function: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = [1.5, item, "two"];
    const result = subject.add(first);
    console.log("WeakSet.prototype.add, form 6, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 6, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 6: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = [1.5, item, "two"];
    const result = subject.add.call(subject, first);
    console.log("WeakSet.prototype.add, form 6, by call, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 6, by call, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 6, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 6, by call: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = [1.5, item, "two"];
    const result = subject.add.apply(subject, [first]);
    console.log("WeakSet.prototype.add, form 6, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 6, by apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 6, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 6, by apply: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = [1.5, item, "two"];
    const result = Reflect.apply(subject.add, subject, [first]);
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const first = [1.5, item, "two"];
    const result = subject.add.bind(subject)(first);
    console.log("WeakSet.prototype.add, form 6, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 6, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 6, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 6, by a bound function: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const result = subject.add(item);
    console.log("WeakSet.prototype.add, form 11, is it an operand:", result === subject, result === item);
    console.log("WeakSet.prototype.add, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 11, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 11: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const result = subject.add.call(subject, item);
    console.log("WeakSet.prototype.add, form 11, by call, is it an operand:", result === subject, result === item);
    console.log("WeakSet.prototype.add, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 11, by call, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 11, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 11, by call: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const result = subject.add.apply(subject, [item]);
    console.log("WeakSet.prototype.add, form 11, by apply, is it an operand:", result === subject, result === item);
    console.log("WeakSet.prototype.add, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 11, by apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 11, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 11, by apply: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const result = Reflect.apply(subject.add, subject, [item]);
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, is it an operand:", result === subject, result === item);
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = new WeakSet([key]);
    const result = subject.add.bind(subject)(item);
    console.log("WeakSet.prototype.add, form 11, by a bound function, is it an operand:", result === subject, result === item);
    console.log("WeakSet.prototype.add, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 11, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 11, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 11, by a bound function: it threw", error instanceof Error);
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
    const subject = new WeakSet();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add(first);
    console.log("WeakSet.prototype.add, form 16, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 16, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 16, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 16, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 16, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 16, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 16, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 16: it threw", error instanceof Error);
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
    const subject = new WeakSet();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add.call(subject, first);
    console.log("WeakSet.prototype.add, form 16, by call, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 16, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 16, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 16, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 16, by call, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 16, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 16, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 16, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 16, by call: it threw", error instanceof Error);
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
    const subject = new WeakSet();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add.apply(subject, [first]);
    console.log("WeakSet.prototype.add, form 16, by apply, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 16, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 16, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 16, by apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 16, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 16, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 16, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 16, by apply: it threw", error instanceof Error);
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
    const subject = new WeakSet();
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.apply(subject.add, subject, [first]);
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 16, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = new WeakSet();
    const first = { first: 1.5, second: "two", third: item };
    const result = subject.add.bind(subject)(first);
    console.log("WeakSet.prototype.add, form 16, by a bound function, is it an operand:", result === subject, result === first);
    console.log("WeakSet.prototype.add, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.add, form 16, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("WeakSet.prototype.add, form 16, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("WeakSet.prototype.add, form 16, by a bound function, its own class:", Object.getPrototypeOf(result) === WeakSet.prototype, Reflect.getPrototypeOf(result) === WeakSet.prototype, result.constructor === WeakSet, Object.getPrototypeOf(result) === Object.getPrototypeOf(WeakSet.prototype));
    console.log("WeakSet.prototype.add, form 16, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("WeakSet.prototype.add, form 16, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("WeakSet.prototype.add, form 16, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("WeakSet.prototype.add, form 16, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet([key]);
    const result = subject.delete(key);
    console.log("WeakSet.prototype.delete, is it an operand:", result === subject);
    console.log("WeakSet.prototype.delete:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.delete, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakSet.prototype.delete: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet([key]);
    const result = subject.delete(1.5);
    console.log("WeakSet.prototype.delete, form 2, is it an operand:", result === subject);
    console.log("WeakSet.prototype.delete, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.delete, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakSet.prototype.delete, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet();
    const result = subject.delete(key);
    console.log("WeakSet.prototype.delete, form 3, is it an operand:", result === subject);
    console.log("WeakSet.prototype.delete, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.delete, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakSet.prototype.delete, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet([key]);
    const result = subject.has(key);
    console.log("WeakSet.prototype.has, is it an operand:", result === subject);
    console.log("WeakSet.prototype.has:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.has, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakSet.prototype.has: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet([key]);
    const result = subject.has(1.5);
    console.log("WeakSet.prototype.has, form 2, is it an operand:", result === subject);
    console.log("WeakSet.prototype.has, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.has, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakSet.prototype.has, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet();
    const result = subject.has(key);
    console.log("WeakSet.prototype.has, form 3, is it an operand:", result === subject);
    console.log("WeakSet.prototype.has, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype.has, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("WeakSet.prototype.has, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet([key]);
    const result = subject[Symbol.toStringTag];
    console.log("WeakSet.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("WeakSet.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakSet.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const key = { name: 1 };
    const subject = new WeakSet();
    const result = subject[Symbol.toStringTag];
    console.log("WeakSet.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("WeakSet.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("WeakSet.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("WeakSet.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
