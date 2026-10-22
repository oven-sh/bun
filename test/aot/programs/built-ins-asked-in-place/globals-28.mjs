// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = encodeURI("an");
    console.log("encodeURI:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("encodeURI, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("encodeURI: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = encodeURI("an");
    console.log("encodeURI, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("encodeURI, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("encodeURI, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = encodeURIComponent("an");
    console.log("encodeURIComponent:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("encodeURIComponent, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("encodeURIComponent: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = encodeURIComponent("an");
    console.log("encodeURIComponent, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("encodeURIComponent, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("encodeURIComponent, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = escape("an");
    console.log("escape:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("escape, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("escape: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = escape("an");
    console.log("escape, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("escape, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("escape, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = isFinite(1.5);
    console.log("isFinite:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("isFinite, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("isFinite: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = isFinite(1.5);
    console.log("isFinite, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("isFinite, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("isFinite, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = isNaN(1.5);
    console.log("isNaN:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("isNaN, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("isNaN: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = isNaN(1.5);
    console.log("isNaN, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("isNaN, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("isNaN, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = parseFloat("an");
    console.log("parseFloat:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("parseFloat, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("parseFloat: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = parseFloat("an");
    console.log("parseFloat, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("parseFloat, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("parseFloat, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = parseInt("an", 2);
    console.log("parseInt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("parseInt, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("parseInt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = parseInt("an", 2);
    console.log("parseInt, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("parseInt, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("parseInt, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = queueMicrotask(callback);
    console.log("queueMicrotask, is it an operand:", result === callback);
    console.log("queueMicrotask:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("queueMicrotask: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = queueMicrotask(callback);
    console.log("queueMicrotask, form 2, is it an operand:", result === callback);
    console.log("queueMicrotask, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("queueMicrotask, form 2: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = setImmediate(callback, second, 2.5);
    console.log("setImmediate, is it an operand:", result === callback, result === second);
    const again = setImmediate(callback, second, 2.5);
    console.log("setImmediate, does a second call answer the same thing:", result === again);
    console.log("setImmediate:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setImmediate, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setImmediate, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setImmediate, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setImmediate, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setImmediate, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setImmediate: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setImmediate(callback, 2.5, 2.5);
    console.log("setImmediate, form 2, is it an operand:", result === callback);
    const again = setImmediate(callback, 2.5, 2.5);
    console.log("setImmediate, form 2, does a second call answer the same thing:", result === again);
    console.log("setImmediate, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setImmediate, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setImmediate, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setImmediate, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setImmediate, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setImmediate, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setImmediate, form 2: it threw", error instanceof Error);
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
    const third = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = setImmediate(callback, item, third);
    console.log("setImmediate, form 3, is it an operand:", result === callback, result === item, result === third);
    const again = setImmediate(callback, item, third);
    console.log("setImmediate, form 3, does a second call answer the same thing:", result === again);
    console.log("setImmediate, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setImmediate, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setImmediate, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setImmediate, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setImmediate, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setImmediate, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setImmediate, form 3: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = setImmediate(callback, second, 2.5);
    console.log("setImmediate, form 4, is it an operand:", result === callback, result === second);
    const again = setImmediate(callback, second, 2.5);
    console.log("setImmediate, form 4, does a second call answer the same thing:", result === again);
    console.log("setImmediate, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setImmediate, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setImmediate, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setImmediate, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setImmediate, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setImmediate, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setImmediate, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2, 3.5, "x");
    console.log("setInterval, is it an operand:", result === callback);
    const again = setInterval(callback, 2, 3.5, "x");
    console.log("setInterval, does a second call answer the same thing:", result === again);
    console.log("setInterval:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2, "x", "x");
    console.log("setInterval, form 2, is it an operand:", result === callback);
    const again = setInterval(callback, 2, "x", "x");
    console.log("setInterval, form 2, does a second call answer the same thing:", result === again);
    console.log("setInterval, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval, form 2: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2, item, 3.5);
    console.log("setInterval, form 3, is it an operand:", result === callback, result === item);
    const again = setInterval(callback, 2, item, 3.5);
    console.log("setInterval, form 3, does a second call answer the same thing:", result === again);
    console.log("setInterval, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2, 3.5, "x");
    console.log("setInterval, form 4, is it an operand:", result === callback);
    const again = setInterval(callback, 2, 3.5, "x");
    console.log("setInterval, form 4, does a second call answer the same thing:", result === again);
    console.log("setInterval, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2.5, 3.5, "x");
    console.log("setInterval, form 5, is it an operand:", result === callback);
    const again = setInterval(callback, 2.5, 3.5, "x");
    console.log("setInterval, form 5, does a second call answer the same thing:", result === again);
    console.log("setInterval, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2.5, "x", "x");
    console.log("setInterval, form 6, is it an operand:", result === callback);
    const again = setInterval(callback, 2.5, "x", "x");
    console.log("setInterval, form 6, does a second call answer the same thing:", result === again);
    console.log("setInterval, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval, form 6: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = setInterval(callback, 2.5, item, 3.5);
    console.log("setInterval, form 7, is it an operand:", result === callback, result === item);
    const again = setInterval(callback, 2.5, item, 3.5);
    console.log("setInterval, form 7, does a second call answer the same thing:", result === again);
    console.log("setInterval, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setInterval, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setInterval, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setInterval, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setInterval, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setInterval, form 7, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setInterval, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2, 3.5, "x");
    console.log("setTimeout, is it an operand:", result === callback);
    const again = setTimeout(callback, 2, 3.5, "x");
    console.log("setTimeout, does a second call answer the same thing:", result === again);
    console.log("setTimeout:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2, "x", "x");
    console.log("setTimeout, form 2, is it an operand:", result === callback);
    const again = setTimeout(callback, 2, "x", "x");
    console.log("setTimeout, form 2, does a second call answer the same thing:", result === again);
    console.log("setTimeout, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout, form 2: it threw", error instanceof Error);
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
    function callback() {
      return true;
    }
    const result = setTimeout(callback, 2, item, 3.5);
    console.log("setTimeout, form 3, is it an operand:", result === callback, result === item);
    const again = setTimeout(callback, 2, item, 3.5);
    console.log("setTimeout, form 3, does a second call answer the same thing:", result === again);
    console.log("setTimeout, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("setTimeout, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("setTimeout, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("setTimeout, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("setTimeout, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("setTimeout, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("setTimeout, form 3: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
