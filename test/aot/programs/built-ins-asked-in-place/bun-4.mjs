// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Bun.peek.apply(Bun, [1.5]);
    console.log("Bun.peek, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 11, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.peek, form 11, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Reflect.apply(Bun.peek, Bun, [1.5]);
    console.log("Bun.peek, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 11, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.peek, form 11, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.peek.bind(Bun)(1.5);
    console.log("Bun.peek, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 11, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.peek, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.peek("an");
    console.log("Bun.peek, form 16:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 16, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.peek, form 16: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.peek.call(Bun, "an");
    console.log("Bun.peek, form 16, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 16, by call, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.peek, form 16, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.peek.apply(Bun, ["an"]);
    console.log("Bun.peek, form 16, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 16, by apply, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.peek, form 16, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Reflect.apply(Bun.peek, Bun, ["an"]);
    console.log("Bun.peek, form 16, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 16, by Reflect.apply, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.peek, form 16, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.peek.bind(Bun)("an");
    console.log("Bun.peek, form 16, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 16, by a bound function, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.peek, form 16, by a bound function: it threw", error instanceof Error);
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
    const result = Bun.peek(item);
    console.log("Bun.peek, form 21, is it an operand:", result === item);
    console.log("Bun.peek, form 21:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 21, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.peek, form 21, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.peek, form 21, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.peek, form 21, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.peek, form 21, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.peek, form 21.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Bun.peek, form 21.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Bun.peek, form 21: it threw", error instanceof Error);
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
    const result = Bun.peek.call(Bun, item);
    console.log("Bun.peek, form 21, by call, is it an operand:", result === item);
    console.log("Bun.peek, form 21, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 21, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.peek, form 21, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.peek, form 21, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.peek, form 21, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.peek, form 21, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.peek, form 21, by call.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Bun.peek, form 21, by call.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Bun.peek, form 21, by call: it threw", error instanceof Error);
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
    const result = Bun.peek.apply(Bun, [item]);
    console.log("Bun.peek, form 21, by apply, is it an operand:", result === item);
    console.log("Bun.peek, form 21, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 21, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.peek, form 21, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.peek, form 21, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.peek, form 21, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.peek, form 21, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.peek, form 21, by apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Bun.peek, form 21, by apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Bun.peek, form 21, by apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(Bun.peek, Bun, [item]);
    console.log("Bun.peek, form 21, by Reflect.apply, is it an operand:", result === item);
    console.log("Bun.peek, form 21, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 21, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.peek, form 21, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.peek, form 21, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.peek, form 21, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.peek, form 21, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.peek, form 21, by Reflect.apply.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Bun.peek, form 21, by Reflect.apply.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Bun.peek, form 21, by Reflect.apply: it threw", error instanceof Error);
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
    const result = Bun.peek.bind(Bun)(item);
    console.log("Bun.peek, form 21, by a bound function, is it an operand:", result === item);
    console.log("Bun.peek, form 21, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.peek, form 21, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.peek, form 21, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.peek, form 21, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.peek, form 21, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.peek, form 21, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.peek, form 21, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.peek, form 21, by a bound function.size:", typeof result.size === "undefined", typeof result.size === "boolean", typeof result.size === "number", typeof result.size === "string", typeof result.size === "bigint", typeof result.size === "symbol", typeof result.size === "function", typeof result.size === "object", result.size === null);
    console.log("Bun.peek, form 21, by a bound function.size, the number:", Number.isInteger(result.size), result.size === result.size, result.size < 0, result.size > 2147483647, result.size < -2147483648, Object.is(result.size, -0), (result.size | 0) === result.size);
  } catch (error) {
    console.log("Bun.peek, form 21, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = new DataView(new ArrayBuffer(16));
    const result = Bun.randomUUIDv5(first, second, 3.5);
    console.log("Bun.randomUUIDv5, is it an operand:", result === first, result === second);
    console.log("Bun.randomUUIDv5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.randomUUIDv5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.randomUUIDv5: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = new DataView(new ArrayBuffer(16));
    const third = { first: 1.5, second: "two", third: item };
    const result = Bun.randomUUIDv5(first, second, third);
    console.log("Bun.randomUUIDv5, form 2, is it an operand:", result === first, result === second, result === third);
    console.log("Bun.randomUUIDv5, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.randomUUIDv5, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.randomUUIDv5, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const second = new DataView(new ArrayBuffer(16));
    const result = Bun.randomUUIDv5(first, second, item);
    console.log("Bun.randomUUIDv5, form 3, is it an operand:", result === first, result === second, result === item);
    console.log("Bun.randomUUIDv5, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.randomUUIDv5, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.randomUUIDv5, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const second = new DataView(new ArrayBuffer(16));
    const result = Bun.randomUUIDv5(first, second, 3.5);
    console.log("Bun.randomUUIDv5, form 4, is it an operand:", result === first, result === second);
    console.log("Bun.randomUUIDv5, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.randomUUIDv5, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.randomUUIDv5, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Date(86400000.5);
    const second = new Date(86400000.5);
    const result = Bun.randomUUIDv7(first, second);
    console.log("Bun.randomUUIDv7, is it an operand:", result === first, result === second);
    const again = Bun.randomUUIDv7(first, second);
    console.log("Bun.randomUUIDv7, does a second call answer the same thing:", result === again);
    console.log("Bun.randomUUIDv7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.randomUUIDv7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Date(86400000.5);
    const second = new Date(86400000.5);
    const result = Bun.randomUUIDv7(first, second);
    console.log("Bun.randomUUIDv7, form 2, is it an operand:", result === first, result === second);
    const again = Bun.randomUUIDv7(first, second);
    console.log("Bun.randomUUIDv7, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.randomUUIDv7, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.randomUUIDv7, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.randomUUIDv7();
    const again = Bun.randomUUIDv7();
    console.log("Bun.randomUUIDv7, form 3, does a second call answer the same thing:", result === again);
    console.log("Bun.randomUUIDv7, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.randomUUIDv7, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToArray(first);
    console.log("Bun.readableStreamToArray, is it an operand:", result === first);
    const again = Bun.readableStreamToArray(first);
    console.log("Bun.readableStreamToArray, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToArray:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToArray, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToArray, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToArray, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToArray, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToArray, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToArray, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToArray, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToArray, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToArray, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToArray, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToArray, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToArray, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Bun.readableStreamToArray, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToArray, settled, its length:", settled.length === 0, settled.length);
      console.log("Bun.readableStreamToArray, settled[0]:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToArray, settled[0], the class:", Array.isArray(settled[0]), settled[0] instanceof Object, settled[0] instanceof Array, settled[0] instanceof Map, settled[0] instanceof Set, settled[0] instanceof Promise, settled[0] instanceof Date, settled[0] instanceof RegExp, settled[0] instanceof Error, settled[0] instanceof ArrayBuffer, settled[0] instanceof Uint8Array, settled[0] instanceof Function, ArrayBuffer.isView(settled[0]));
      console.log("Bun.readableStreamToArray, settled[0], above it:", Object.getPrototypeOf(settled[0]) === Object.prototype, Object.getPrototypeOf(settled[0]) === Array.prototype, Object.getPrototypeOf(settled[0]) === null);
      console.log("Bun.readableStreamToArray, settled[0], its own class:", Object.getPrototypeOf(settled[0]) === Uint8Array.prototype, Reflect.getPrototypeOf(settled[0]) === Uint8Array.prototype, settled[0].constructor === Uint8Array, Object.getPrototypeOf(settled[0]) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Bun.readableStreamToArray, settled[0], its state:", Object.isFrozen(settled[0]), Object.isSealed(settled[0]), Object.isExtensible(settled[0]));
      console.log("Bun.readableStreamToArray, settled[0], names in it:", "length" in settled[0], "size" in settled[0], "then" in settled[0], "next" in settled[0], "constructor" in settled[0], Symbol.iterator in settled[0]);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Bun.readableStreamToArray, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Bun.readableStreamToArray: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToArray(first);
    console.log("Bun.readableStreamToArray, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToArray(first);
    console.log("Bun.readableStreamToArray, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToArray, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToArray, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToArray, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToArray, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToArray, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToArray, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToArray, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToArray, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToArray, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToArray, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToArray, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToArray, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToArray, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Bun.readableStreamToArray, form 2, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToArray, form 2, settled, its length:", settled.length === 0, settled.length);
      console.log("Bun.readableStreamToArray, form 2, settled[0]:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToArray, form 2, settled[0], the class:", Array.isArray(settled[0]), settled[0] instanceof Object, settled[0] instanceof Array, settled[0] instanceof Map, settled[0] instanceof Set, settled[0] instanceof Promise, settled[0] instanceof Date, settled[0] instanceof RegExp, settled[0] instanceof Error, settled[0] instanceof ArrayBuffer, settled[0] instanceof Uint8Array, settled[0] instanceof Function, ArrayBuffer.isView(settled[0]));
      console.log("Bun.readableStreamToArray, form 2, settled[0], above it:", Object.getPrototypeOf(settled[0]) === Object.prototype, Object.getPrototypeOf(settled[0]) === Array.prototype, Object.getPrototypeOf(settled[0]) === null);
      console.log("Bun.readableStreamToArray, form 2, settled[0], its own class:", Object.getPrototypeOf(settled[0]) === Uint8Array.prototype, Reflect.getPrototypeOf(settled[0]) === Uint8Array.prototype, settled[0].constructor === Uint8Array, Object.getPrototypeOf(settled[0]) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Bun.readableStreamToArray, form 2, settled[0], its state:", Object.isFrozen(settled[0]), Object.isSealed(settled[0]), Object.isExtensible(settled[0]));
      console.log("Bun.readableStreamToArray, form 2, settled[0], names in it:", "length" in settled[0], "size" in settled[0], "then" in settled[0], "next" in settled[0], "constructor" in settled[0], Symbol.iterator in settled[0]);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToArray, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Bun.readableStreamToArray, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Bun.readableStreamToArray, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToArrayBuffer(first);
    console.log("Bun.readableStreamToArrayBuffer, is it an operand:", result === first);
    const again = Bun.readableStreamToArrayBuffer(first);
    console.log("Bun.readableStreamToArrayBuffer, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToArrayBuffer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToArrayBuffer, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToArrayBuffer, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToArrayBuffer, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToArrayBuffer, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToArrayBuffer, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToArrayBuffer, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToArrayBuffer, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToArrayBuffer, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToArrayBuffer, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToArrayBuffer, settled, its own class:", Object.getPrototypeOf(settled) === ArrayBuffer.prototype, Reflect.getPrototypeOf(settled) === ArrayBuffer.prototype, settled.constructor === ArrayBuffer, Object.getPrototypeOf(settled) === Object.getPrototypeOf(ArrayBuffer.prototype));
      console.log("Bun.readableStreamToArrayBuffer, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToArrayBuffer, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToArrayBuffer, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Bun.readableStreamToArrayBuffer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToArrayBuffer(first);
    console.log("Bun.readableStreamToArrayBuffer, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToArrayBuffer(first);
    console.log("Bun.readableStreamToArrayBuffer, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToArrayBuffer, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToArrayBuffer, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToArrayBuffer, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToArrayBuffer, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToArrayBuffer, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToArrayBuffer, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToArrayBuffer, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled, its own class:", Object.getPrototypeOf(settled) === ArrayBuffer.prototype, Reflect.getPrototypeOf(settled) === ArrayBuffer.prototype, settled.constructor === ArrayBuffer, Object.getPrototypeOf(settled) === Object.getPrototypeOf(ArrayBuffer.prototype));
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToArrayBuffer, form 2, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Bun.readableStreamToArrayBuffer, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToBlob(first);
    console.log("Bun.readableStreamToBlob, is it an operand:", result === first);
    const again = Bun.readableStreamToBlob(first);
    console.log("Bun.readableStreamToBlob, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToBlob:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToBlob, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToBlob, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToBlob, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToBlob, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToBlob, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToBlob, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToBlob, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToBlob, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToBlob, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToBlob, settled, its own class:", Object.getPrototypeOf(settled) === Blob.prototype, Reflect.getPrototypeOf(settled) === Blob.prototype, settled.constructor === Blob, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Blob.prototype));
      console.log("Bun.readableStreamToBlob, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToBlob, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToBlob, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Bun.readableStreamToBlob: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToBlob(first);
    console.log("Bun.readableStreamToBlob, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToBlob(first);
    console.log("Bun.readableStreamToBlob, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToBlob, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToBlob, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToBlob, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToBlob, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToBlob, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToBlob, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToBlob, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToBlob, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToBlob, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToBlob, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToBlob, form 2, settled, its own class:", Object.getPrototypeOf(settled) === Blob.prototype, Reflect.getPrototypeOf(settled) === Blob.prototype, settled.constructor === Blob, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Blob.prototype));
      console.log("Bun.readableStreamToBlob, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToBlob, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToBlob, form 2, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Bun.readableStreamToBlob, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToBytes(first);
    console.log("Bun.readableStreamToBytes, is it an operand:", result === first);
    const again = Bun.readableStreamToBytes(first);
    console.log("Bun.readableStreamToBytes, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToBytes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToBytes, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToBytes, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToBytes, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToBytes, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToBytes, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToBytes, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToBytes, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToBytes, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToBytes, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToBytes, settled, its own class:", Object.getPrototypeOf(settled) === Uint8Array.prototype, Reflect.getPrototypeOf(settled) === Uint8Array.prototype, settled.constructor === Uint8Array, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Bun.readableStreamToBytes, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToBytes, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToBytes, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Bun.readableStreamToBytes, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToBytes, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Bun.readableStreamToBytes, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Bun.readableStreamToBytes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToBytes(first);
    console.log("Bun.readableStreamToBytes, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToBytes(first);
    console.log("Bun.readableStreamToBytes, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToBytes, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToBytes, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToBytes, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToBytes, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToBytes, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToBytes, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToBytes, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToBytes, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToBytes, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToBytes, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToBytes, form 2, settled, its own class:", Object.getPrototypeOf(settled) === Uint8Array.prototype, Reflect.getPrototypeOf(settled) === Uint8Array.prototype, settled.constructor === Uint8Array, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Bun.readableStreamToBytes, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToBytes, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToBytes, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Bun.readableStreamToBytes, form 2, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToBytes, form 2, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToBytes, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Bun.readableStreamToBytes, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Bun.readableStreamToBytes, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToFormData(first, 2.5);
    console.log("Bun.readableStreamToFormData, is it an operand:", result === first);
    const again = Bun.readableStreamToFormData(first, 2.5);
    console.log("Bun.readableStreamToFormData, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToFormData:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToFormData, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToFormData, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToFormData, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToFormData, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToFormData, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToFormData, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.readableStreamToFormData: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToFormData(first, "-");
    console.log("Bun.readableStreamToFormData, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToFormData(first, "-");
    console.log("Bun.readableStreamToFormData, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToFormData, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToFormData, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToFormData, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToFormData, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToFormData, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToFormData, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToFormData, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.readableStreamToFormData, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
