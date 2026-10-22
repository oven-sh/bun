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
    const second = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = Reflect.apply(callback, second, third);
    console.log("Reflect.apply, is it an operand:", result === callback, result === second, result === third);
    console.log("Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.apply: it threw", error instanceof Error);
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
    const result = Reflect.apply(callback, 2.5, third);
    console.log("Reflect.apply, form 2, is it an operand:", result === callback, result === third);
    console.log("Reflect.apply, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.apply, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.apply, form 2: it threw", error instanceof Error);
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
    const result = Reflect.apply(callback, item, third);
    console.log("Reflect.apply, form 3, is it an operand:", result === callback, result === item, result === third);
    console.log("Reflect.apply, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.apply, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.apply, form 3: it threw", error instanceof Error);
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
    const third = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = Reflect.apply(callback, second, third);
    console.log("Reflect.apply, form 4, is it an operand:", result === callback, result === second, result === third);
    console.log("Reflect.apply, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.apply, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.apply, form 4: it threw", error instanceof Error);
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
    const result = Reflect.construct(callback, second);
    console.log("Reflect.construct, is it an operand:", result === callback, result === second);
    console.log("Reflect.construct:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.construct, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.construct, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.construct, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.construct, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.construct, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.construct: it threw", error instanceof Error);
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
    const second = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = Reflect.construct(callback, second);
    console.log("Reflect.construct, form 2, is it an operand:", result === callback, result === second);
    console.log("Reflect.construct, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.construct, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.construct, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.construct, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.construct, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.construct, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.construct, form 2: it threw", error instanceof Error);
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
    const result = Reflect.construct(callback, second);
    console.log("Reflect.construct, form 3, is it an operand:", result === callback, result === second);
    console.log("Reflect.construct, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.construct, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.construct, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.construct, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.construct, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.construct, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.construct, form 3: it threw", error instanceof Error);
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
    function otherCallback() {
      return true;
    }
    const result = Reflect.construct(callback, second, otherCallback);
    console.log("Reflect.construct, form 4, is it an operand:", result === callback, result === second, result === otherCallback);
    console.log("Reflect.construct, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.construct, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.construct, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.construct, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.construct, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.construct, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.construct, form 4: it threw", error instanceof Error);
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
    const second = [1.5, item, "two"];
    function callback() {
      return true;
    }
    function otherCallback() {
      return true;
    }
    const result = Reflect.construct(callback, second, otherCallback);
    console.log("Reflect.construct, form 5, is it an operand:", result === callback, result === second, result === otherCallback);
    console.log("Reflect.construct, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.construct, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.construct, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.construct, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.construct, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.construct, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.construct, form 5: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Reflect.defineProperty(first, "-", third);
    console.log("Reflect.defineProperty, is it an operand:", result === first, result === third);
    console.log("Reflect.defineProperty:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.defineProperty, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.defineProperty: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const third = { first: 1.5, second: "two", third: item };
    const result = Reflect.defineProperty(first, "-", third);
    console.log("Reflect.defineProperty, form 2, is it an operand:", result === first, result === third);
    console.log("Reflect.defineProperty, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.defineProperty, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.defineProperty, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const third = { first: 1.5, second: "two", third: item };
    const result = Reflect.defineProperty(first, "-", third);
    console.log("Reflect.defineProperty, form 3, is it an operand:", result === first, result === third);
    console.log("Reflect.defineProperty, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.defineProperty, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.defineProperty, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.deleteProperty(first, "-");
    console.log("Reflect.deleteProperty, is it an operand:", result === first);
    console.log("Reflect.deleteProperty:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.deleteProperty, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.deleteProperty: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.deleteProperty(first, "-");
    console.log("Reflect.deleteProperty, form 2, is it an operand:", result === first);
    console.log("Reflect.deleteProperty, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.deleteProperty, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.deleteProperty, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.deleteProperty(first, "-");
    console.log("Reflect.deleteProperty, form 3, is it an operand:", result === first);
    console.log("Reflect.deleteProperty, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.deleteProperty, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.deleteProperty, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.getOwnPropertyDescriptor(first, "-");
    console.log("Reflect.getOwnPropertyDescriptor, is it an operand:", result === first);
    const again = Reflect.getOwnPropertyDescriptor(first, "-");
    console.log("Reflect.getOwnPropertyDescriptor, does a second call answer the same thing:", result === again);
    console.log("Reflect.getOwnPropertyDescriptor:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Reflect.getOwnPropertyDescriptor: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.getOwnPropertyDescriptor(first, "-");
    console.log("Reflect.getOwnPropertyDescriptor, form 2, is it an operand:", result === first);
    const again = Reflect.getOwnPropertyDescriptor(first, "-");
    console.log("Reflect.getOwnPropertyDescriptor, form 2, does a second call answer the same thing:", result === again);
    console.log("Reflect.getOwnPropertyDescriptor, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Reflect.getOwnPropertyDescriptor, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.getOwnPropertyDescriptor(first, "-");
    console.log("Reflect.getOwnPropertyDescriptor, form 3, is it an operand:", result === first);
    const again = Reflect.getOwnPropertyDescriptor(first, "-");
    console.log("Reflect.getOwnPropertyDescriptor, form 3, does a second call answer the same thing:", result === again);
    console.log("Reflect.getOwnPropertyDescriptor, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Reflect.getOwnPropertyDescriptor, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.getPrototypeOf(first);
    console.log("Reflect.getPrototypeOf, is it an operand:", result === first);
    console.log("Reflect.getPrototypeOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.getPrototypeOf, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.getPrototypeOf, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.getPrototypeOf, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.getPrototypeOf, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.getPrototypeOf: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.getPrototypeOf(first);
    console.log("Reflect.getPrototypeOf, form 2, is it an operand:", result === first);
    console.log("Reflect.getPrototypeOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.getPrototypeOf, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.getPrototypeOf, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.getPrototypeOf, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.getPrototypeOf, form 2, how many keys:", Object.keys(result).length);
    console.log("Reflect.getPrototypeOf, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Reflect.getPrototypeOf, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Reflect.getPrototypeOf, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Reflect.getPrototypeOf, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Reflect.getPrototypeOf, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.getPrototypeOf(first);
    console.log("Reflect.getPrototypeOf, form 3, is it an operand:", result === first);
    console.log("Reflect.getPrototypeOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.getPrototypeOf, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.getPrototypeOf, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.getPrototypeOf, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.getPrototypeOf, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Reflect.getPrototypeOf, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.has(first, "-");
    console.log("Reflect.has, is it an operand:", result === first);
    console.log("Reflect.has:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.has, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.has: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.has(first, "-");
    console.log("Reflect.has, form 2, is it an operand:", result === first);
    console.log("Reflect.has, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.has, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.has, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.has(first, "-");
    console.log("Reflect.has, form 3, is it an operand:", result === first);
    console.log("Reflect.has, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.has, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.has, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.isExtensible(first);
    console.log("Reflect.isExtensible, is it an operand:", result === first);
    console.log("Reflect.isExtensible:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.isExtensible, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.isExtensible: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.isExtensible(first);
    console.log("Reflect.isExtensible, form 2, is it an operand:", result === first);
    console.log("Reflect.isExtensible, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.isExtensible, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.isExtensible, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.isExtensible(first);
    console.log("Reflect.isExtensible, form 3, is it an operand:", result === first);
    console.log("Reflect.isExtensible, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.isExtensible, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.isExtensible, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.ownKeys(first);
    console.log("Reflect.ownKeys, is it an operand:", result === first);
    const again = Reflect.ownKeys(first);
    console.log("Reflect.ownKeys, does a second call answer the same thing:", result === again);
    console.log("Reflect.ownKeys:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.ownKeys, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.ownKeys, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.ownKeys, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.ownKeys, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.ownKeys, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Reflect.ownKeys, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Reflect.ownKeys, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Reflect.ownKeys, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Reflect.ownKeys: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.ownKeys(first);
    console.log("Reflect.ownKeys, form 2, is it an operand:", result === first);
    const again = Reflect.ownKeys(first);
    console.log("Reflect.ownKeys, form 2, does a second call answer the same thing:", result === again);
    console.log("Reflect.ownKeys, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.ownKeys, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.ownKeys, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.ownKeys, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.ownKeys, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.ownKeys, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Reflect.ownKeys, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Reflect.ownKeys, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Reflect.ownKeys, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Reflect.ownKeys, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.ownKeys(first);
    console.log("Reflect.ownKeys, form 3, is it an operand:", result === first);
    const again = Reflect.ownKeys(first);
    console.log("Reflect.ownKeys, form 3, does a second call answer the same thing:", result === again);
    console.log("Reflect.ownKeys, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.ownKeys, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Reflect.ownKeys, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Reflect.ownKeys, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Reflect.ownKeys, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Reflect.ownKeys, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Reflect.ownKeys, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Reflect.ownKeys, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Reflect.ownKeys, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Reflect.ownKeys, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Reflect.ownKeys, form 3: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
