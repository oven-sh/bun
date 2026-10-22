// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = AsyncDisposableStack.length;
    console.log("AsyncDisposableStack.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("AsyncDisposableStack.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("AsyncDisposableStack.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = AsyncDisposableStack.name;
    console.log("AsyncDisposableStack.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt(1.5, callback);
    console.log("AsyncDisposableStack.prototype.adopt, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.call(subject, 1.5, callback);
    console.log("AsyncDisposableStack.prototype.adopt, by call, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, by call, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.apply(subject, [1.5, callback]);
    console.log("AsyncDisposableStack.prototype.adopt, by apply, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.adopt, subject, [1.5, callback]);
    console.log("AsyncDisposableStack.prototype.adopt, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.bind(subject)(1.5, callback);
    console.log("AsyncDisposableStack.prototype.adopt, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt("an", callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.call(subject, "an", callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by call, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.apply(subject, ["an", callback]);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by apply, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.adopt, subject, ["an", callback]);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by Reflect.apply, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.bind(subject)("an", callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by a bound function, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 6, by a bound function: it threw", error instanceof Error);
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
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt(item, callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, is it an operand:", result === subject, result === item, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AsyncDisposableStack.prototype.adopt, form 11.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 11: it threw", error instanceof Error);
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
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.call(subject, item, callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, is it an operand:", result === subject, result === item, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by call: it threw", error instanceof Error);
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
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.apply(subject, [item, callback]);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, is it an operand:", result === subject, result === item, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by apply: it threw", error instanceof Error);
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
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.adopt, subject, [item, callback]);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, is it an operand:", result === subject, result === item, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.bind(subject)(item, callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, is it an operand:", result === subject, result === item, result === callback);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.adopt, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    function callback() {
      return true;
    }
    const result = subject.defer(callback);
    console.log("AsyncDisposableStack.prototype.defer, is it an operand:", result === subject, result === callback);
    console.log("AsyncDisposableStack.prototype.defer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.defer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    const result = subject.disposeAsync();
    console.log("AsyncDisposableStack.prototype.disposeAsync, is it an operand:", result === subject);
    const again = subject.disposeAsync();
    console.log("AsyncDisposableStack.prototype.disposeAsync, does a second call answer the same thing:", result === again);
    console.log("AsyncDisposableStack.prototype.disposeAsync:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.disposeAsync, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.disposeAsync, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.disposeAsync, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("AsyncDisposableStack.prototype.disposeAsync, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.disposeAsync, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.disposeAsync, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("AsyncDisposableStack.prototype.disposeAsync, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
    }
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.disposeAsync: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    const result = subject.disposed;
    console.log("AsyncDisposableStack.prototype.disposed, get, is it an operand:", result === subject);
    console.log("AsyncDisposableStack.prototype.disposed, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.disposed, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.disposed, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    const result = subject.move();
    console.log("AsyncDisposableStack.prototype.move, is it an operand:", result === subject);
    const again = subject.move();
    console.log("AsyncDisposableStack.prototype.move, does a second call answer the same thing:", result === again);
    console.log("AsyncDisposableStack.prototype.move:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype.move, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("AsyncDisposableStack.prototype.move, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("AsyncDisposableStack.prototype.move, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("AsyncDisposableStack.prototype.move, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("AsyncDisposableStack.prototype.move, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("AsyncDisposableStack.prototype.move: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new AsyncDisposableStack();
    const result = subject[Symbol.toStringTag];
    console.log("AsyncDisposableStack.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("AsyncDisposableStack.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("AsyncDisposableStack.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("AsyncDisposableStack.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
