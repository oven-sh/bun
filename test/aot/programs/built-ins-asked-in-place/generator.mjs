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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.next(1.5);
    console.log("%Generator%.prototype.next, is it an operand:", result === subject);
    const again = subject.next(1.5);
    console.log("%Generator%.prototype.next, does a second call answer the same thing:", result === again);
    console.log("%Generator%.prototype.next:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype.next, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Generator%.prototype.next, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Generator%.prototype.next, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Generator%.prototype.next, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%Generator%.prototype.next, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%Generator%.prototype.next.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%Generator%.prototype.next.value, the number:", Number.isInteger(result.value), result.value === result.value, result.value < 0, result.value > 2147483647, result.value < -2147483648, Object.is(result.value, -0), (result.value | 0) === result.value);
    console.log("%Generator%.prototype.next.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%Generator%.prototype.next.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%Generator%.prototype.next: it threw", error instanceof Error);
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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.next("an");
    console.log("%Generator%.prototype.next, form 2, is it an operand:", result === subject);
    const again = subject.next("an");
    console.log("%Generator%.prototype.next, form 2, does a second call answer the same thing:", result === again);
    console.log("%Generator%.prototype.next, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype.next, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Generator%.prototype.next, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Generator%.prototype.next, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Generator%.prototype.next, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%Generator%.prototype.next, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%Generator%.prototype.next, form 2.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%Generator%.prototype.next, form 2.value, the number:", Number.isInteger(result.value), result.value === result.value, result.value < 0, result.value > 2147483647, result.value < -2147483648, Object.is(result.value, -0), (result.value | 0) === result.value);
    console.log("%Generator%.prototype.next, form 2.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%Generator%.prototype.next, form 2.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%Generator%.prototype.next, form 2: it threw", error instanceof Error);
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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.next(item);
    console.log("%Generator%.prototype.next, form 3, is it an operand:", result === subject, result === item);
    const again = subject.next(item);
    console.log("%Generator%.prototype.next, form 3, does a second call answer the same thing:", result === again);
    console.log("%Generator%.prototype.next, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype.next, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Generator%.prototype.next, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Generator%.prototype.next, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Generator%.prototype.next, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%Generator%.prototype.next, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.next, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%Generator%.prototype.next, form 3.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%Generator%.prototype.next, form 3.value, the number:", Number.isInteger(result.value), result.value === result.value, result.value < 0, result.value > 2147483647, result.value < -2147483648, Object.is(result.value, -0), (result.value | 0) === result.value);
    console.log("%Generator%.prototype.next, form 3.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%Generator%.prototype.next, form 3.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%Generator%.prototype.next, form 3: it threw", error instanceof Error);
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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.return(1.5);
    console.log("%Generator%.prototype.return, is it an operand:", result === subject);
    const again = subject.return(1.5);
    console.log("%Generator%.prototype.return, does a second call answer the same thing:", result === again);
    console.log("%Generator%.prototype.return:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype.return, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Generator%.prototype.return, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Generator%.prototype.return, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Generator%.prototype.return, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%Generator%.prototype.return, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%Generator%.prototype.return.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%Generator%.prototype.return.value, the number:", Number.isInteger(result.value), result.value === result.value, result.value < 0, result.value > 2147483647, result.value < -2147483648, Object.is(result.value, -0), (result.value | 0) === result.value);
    console.log("%Generator%.prototype.return.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%Generator%.prototype.return.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%Generator%.prototype.return: it threw", error instanceof Error);
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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.return("an");
    console.log("%Generator%.prototype.return, form 2, is it an operand:", result === subject);
    const again = subject.return("an");
    console.log("%Generator%.prototype.return, form 2, does a second call answer the same thing:", result === again);
    console.log("%Generator%.prototype.return, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype.return, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Generator%.prototype.return, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Generator%.prototype.return, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Generator%.prototype.return, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%Generator%.prototype.return, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%Generator%.prototype.return, form 2.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%Generator%.prototype.return, form 2.value, the text:", result.value.length === 0, result.value === "");
    console.log("%Generator%.prototype.return, form 2.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%Generator%.prototype.return, form 2.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%Generator%.prototype.return, form 2: it threw", error instanceof Error);
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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject.return(item);
    console.log("%Generator%.prototype.return, form 3, is it an operand:", result === subject, result === item);
    const again = subject.return(item);
    console.log("%Generator%.prototype.return, form 3, does a second call answer the same thing:", result === again);
    console.log("%Generator%.prototype.return, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype.return, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%Generator%.prototype.return, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%Generator%.prototype.return, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%Generator%.prototype.return, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%Generator%.prototype.return, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%Generator%.prototype.return, form 3.value:", typeof result.value === "undefined", typeof result.value === "boolean", typeof result.value === "number", typeof result.value === "string", typeof result.value === "bigint", typeof result.value === "symbol", typeof result.value === "function", typeof result.value === "object", result.value === null);
    console.log("%Generator%.prototype.return, form 3.value, the class:", Array.isArray(result.value), result.value instanceof Object, result.value instanceof Array, result.value instanceof Map, result.value instanceof Set, result.value instanceof Promise, result.value instanceof Date, result.value instanceof RegExp, result.value instanceof Error, result.value instanceof ArrayBuffer, result.value instanceof Uint8Array, result.value instanceof Function, ArrayBuffer.isView(result.value));
    console.log("%Generator%.prototype.return, form 3.value, above it:", Object.getPrototypeOf(result.value) === Object.prototype, Object.getPrototypeOf(result.value) === Array.prototype, Object.getPrototypeOf(result.value) === null);
    console.log("%Generator%.prototype.return, form 3.value, its state:", Object.isFrozen(result.value), Object.isSealed(result.value), Object.isExtensible(result.value));
    console.log("%Generator%.prototype.return, form 3.value, names in it:", "length" in result.value, "size" in result.value, "then" in result.value, "next" in result.value, "constructor" in result.value, Symbol.iterator in result.value);
    console.log("%Generator%.prototype.return, form 3.value, how many keys:", Object.keys(result.value).length);
    {
      let asked = 0;
      for (const value of Object.values(result.value)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 3.value, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.value)) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 3.value, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.value) {
        if (asked++ === 4) break;
        console.log("%Generator%.prototype.return, form 3.value, by for-in:", typeof key === "string", typeof result.value[key] === "undefined", typeof result.value[key] === "boolean", typeof result.value[key] === "number", typeof result.value[key] === "string", typeof result.value[key] === "bigint", typeof result.value[key] === "symbol", typeof result.value[key] === "function", typeof result.value[key] === "object", result.value[key] === null);
      }
    }
    console.log("%Generator%.prototype.return, form 3.value.size:", typeof result.value.size === "undefined", typeof result.value.size === "boolean", typeof result.value.size === "number", typeof result.value.size === "string", typeof result.value.size === "bigint", typeof result.value.size === "symbol", typeof result.value.size === "function", typeof result.value.size === "object", result.value.size === null);
    console.log("%Generator%.prototype.return, form 3.value.size, the number:", Number.isInteger(result.value.size), result.value.size === result.value.size, result.value.size < 0, result.value.size > 2147483647, result.value.size < -2147483648, Object.is(result.value.size, -0), (result.value.size | 0) === result.value.size);
    console.log("%Generator%.prototype.return, form 3.done:", typeof result.done === "undefined", typeof result.done === "boolean", typeof result.done === "number", typeof result.done === "string", typeof result.done === "bigint", typeof result.done === "symbol", typeof result.done === "function", typeof result.done === "object", result.done === null);
    console.log("%Generator%.prototype.return, form 3.done, the boolean:", result.done === true, result.done === false, !result.done);
  } catch (error) {
    console.log("%Generator%.prototype.return, form 3: it threw", error instanceof Error);
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
    function* numbers() {
      const sent = yield 1.5;
      yield sent ?? "two";
      return item;
    }
    const subject = numbers();
    const result = subject[Symbol.toStringTag];
    console.log("%Generator%.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("%Generator%.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%Generator%.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%Generator%.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
