// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.sort.call(subject, callback);
    console.log("%TypedArray%.prototype.sort, form 11, by call, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 11, by call, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 11, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, form 11, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 11, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 11, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 11, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.sort.apply(subject, [callback]);
    console.log("%TypedArray%.prototype.sort, form 11, by apply, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 11, by apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 11, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, form 11, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 11, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 11, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 11, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.sort, subject, [callback]);
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 11, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.sort.bind(subject)(callback);
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 11, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 11, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    function callback() {
      return true;
    }
    const result = subject.sort(callback);
    console.log("%TypedArray%.prototype.sort, form 16, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 16, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 16, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 16, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 16, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 16, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 16, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 16, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 16, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 16, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 16, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    function callback() {
      return true;
    }
    const result = subject.sort.call(subject, callback);
    console.log("%TypedArray%.prototype.sort, form 16, by call, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 16, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 16, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 16, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 16, by call, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 16, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 16, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 16, by call, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 16, by call, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 16, by call, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 16, by call, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 16, by call, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 16, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    function callback() {
      return true;
    }
    const result = subject.sort.apply(subject, [callback]);
    console.log("%TypedArray%.prototype.sort, form 16, by apply, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 16, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 16, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 16, by apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 16, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 16, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 16, by apply, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 16, by apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 16, by apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 16, by apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 16, by apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 16, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.sort, subject, [callback]);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 16, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    function callback() {
      return true;
    }
    const result = subject.sort.bind(subject)(callback);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.sort, form 16, by a bound function, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.sort, form 16, by a bound function, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.sort, form 16, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.subarray(1, 2);
    console.log("%TypedArray%.prototype.subarray, is it an operand:", result === subject);
    const again = subject.subarray(1, 2);
    console.log("%TypedArray%.prototype.subarray, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.subarray:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.subarray, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.subarray, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.subarray, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.subarray, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.subarray, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.subarray, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.subarray, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.subarray, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.subarray, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.subarray: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.subarray(1, 2);
    console.log("%TypedArray%.prototype.subarray, form 2, is it an operand:", result === subject);
    const again = subject.subarray(1, 2);
    console.log("%TypedArray%.prototype.subarray, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.subarray, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.subarray, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.subarray, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.subarray, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.subarray, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.subarray, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.subarray, form 2, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.subarray, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.subarray, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.subarray, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.subarray, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.subarray(1, 2);
    console.log("%TypedArray%.prototype.subarray, form 3, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.subarray, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.subarray, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.subarray, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.subarray, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.subarray, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.subarray, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.subarray, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.subarray, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.subarray, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.subarray, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.subarray, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.subarray(1, 2);
    console.log("%TypedArray%.prototype.subarray, form 4, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.subarray, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.subarray, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.subarray, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.subarray, form 4, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.subarray, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.subarray, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.subarray, form 4, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.subarray, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.subarray, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.subarray, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.subarray, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.subarray, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toLocaleString(1.5, 2.5);
    console.log("%TypedArray%.prototype.toLocaleString, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.toLocaleString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.toLocaleString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toLocaleString("an", 2.5);
    console.log("%TypedArray%.prototype.toLocaleString, form 2, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.toLocaleString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.toLocaleString, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toLocaleString(item, item);
    console.log("%TypedArray%.prototype.toLocaleString, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("%TypedArray%.prototype.toLocaleString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.toLocaleString, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.toLocaleString(1.5, 2.5);
    console.log("%TypedArray%.prototype.toLocaleString, form 4, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.toLocaleString, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.toLocaleString, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toReversed();
    console.log("%TypedArray%.prototype.toReversed, is it an operand:", result === subject);
    const again = subject.toReversed();
    console.log("%TypedArray%.prototype.toReversed, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.toReversed:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.toReversed, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.toReversed, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.toReversed, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.toReversed, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.toReversed, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.toReversed, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toReversed, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toReversed, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toReversed, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.toReversed, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.toReversed, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toReversed, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.toReversed, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.toReversed: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.toReversed();
    console.log("%TypedArray%.prototype.toReversed, form 2, is it an operand:", result === subject);
    const again = subject.toReversed();
    console.log("%TypedArray%.prototype.toReversed, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.toReversed, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.toReversed, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.toReversed, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.toReversed, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.toReversed, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.toReversed, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.toReversed, form 2, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.toReversed, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.toReversed, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toReversed, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.toReversed, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.toReversed, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toSorted();
    console.log("%TypedArray%.prototype.toSorted, is it an operand:", result === subject);
    const again = subject.toSorted();
    console.log("%TypedArray%.prototype.toSorted, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.toSorted:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.toSorted, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.toSorted, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.toSorted, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.toSorted, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.toSorted, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.toSorted, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.toSorted, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.toSorted, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.toSorted, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.toSorted: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.toSorted();
    console.log("%TypedArray%.prototype.toSorted, form 2, is it an operand:", result === subject);
    const again = subject.toSorted();
    console.log("%TypedArray%.prototype.toSorted, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.toSorted, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.toSorted, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.toSorted, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.toSorted, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.toSorted, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.toSorted, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.toSorted, form 2, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.toSorted, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.toSorted, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.toSorted, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.toSorted, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.toSorted(callback);
    console.log("%TypedArray%.prototype.toSorted, form 3, is it an operand:", result === subject, result === callback);
    const again = subject.toSorted(callback);
    console.log("%TypedArray%.prototype.toSorted, form 3, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.toSorted, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.toSorted, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.toSorted, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.toSorted, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.toSorted, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.toSorted, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.toSorted, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.toSorted, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.toSorted, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.toSorted, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.toSorted, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    function callback() {
      return true;
    }
    const result = subject.toSorted(callback);
    console.log("%TypedArray%.prototype.toSorted, form 4, is it an operand:", result === subject, result === callback);
    const again = subject.toSorted(callback);
    console.log("%TypedArray%.prototype.toSorted, form 4, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.toSorted, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.toSorted, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.toSorted, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.toSorted, form 4, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.toSorted, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.toSorted, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.toSorted, form 4, how many keys:", Object.keys(result).length);
    console.log("%TypedArray%.prototype.toSorted, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.toSorted, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.toSorted, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.toSorted, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.toSorted, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.values();
    console.log("%TypedArray%.prototype.values, is it an operand:", result === subject);
    const again = subject.values();
    console.log("%TypedArray%.prototype.values, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.values:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.values, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.values, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.values, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.values, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.values, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.values, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.values, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.values: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.values();
    console.log("%TypedArray%.prototype.values, form 2, is it an operand:", result === subject);
    const again = subject.values();
    console.log("%TypedArray%.prototype.values, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.values, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.values, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.values, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.values, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.values, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.values, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.values, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.values, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.values, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.with(1, 2.5);
    console.log("%TypedArray%.prototype.with, is it an operand:", result === subject);
    const again = subject.with(1, 2.5);
    console.log("%TypedArray%.prototype.with, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.with:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.with, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.with, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.with, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.with, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.with, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.with, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.with, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.with, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.with, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.with: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.with(1, "-");
    console.log("%TypedArray%.prototype.with, form 2, is it an operand:", result === subject);
    const again = subject.with(1, "-");
    console.log("%TypedArray%.prototype.with, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.with, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.with, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.with, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.with, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.with, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.with, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.with, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.with, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.with, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.with, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.with, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.with(1, item);
    console.log("%TypedArray%.prototype.with, form 3, is it an operand:", result === subject, result === item);
    const again = subject.with(1, item);
    console.log("%TypedArray%.prototype.with, form 3, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.with, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.with, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.with, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.with, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("%TypedArray%.prototype.with, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.with, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.with, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%TypedArray%.prototype.with, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%TypedArray%.prototype.with, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.with, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.with, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.with, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject[Symbol.toStringTag];
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject[Symbol.toStringTag];
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get, form 2, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%TypedArray%.prototype[Symbol.toStringTag], get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
