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
    const subject = [1.5, item, "two"].values();
    const result = subject.join("an");
    console.log("Iterator.prototype.join, form 2, is it an operand:", result === subject);
    console.log("Iterator.prototype.join, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.join, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Iterator.prototype.join, form 2: it threw", error instanceof Error);
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
    const subject = [item, item].values();
    const result = subject.join(item);
    console.log("Iterator.prototype.join, form 3, is it an operand:", result === subject, result === item);
    console.log("Iterator.prototype.join, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.join, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Iterator.prototype.join, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    const result = subject.join(1.5);
    console.log("Iterator.prototype.join, form 4, is it an operand:", result === subject);
    console.log("Iterator.prototype.join, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.join, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Iterator.prototype.join, form 4: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.map(callback);
    console.log("Iterator.prototype.map, is it an operand:", result === subject, result === callback);
    const again = subject.map(callback);
    console.log("Iterator.prototype.map, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.map:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.map, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.map, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.map, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.map, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.map, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.map, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.map, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.map: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = subject.map(callback);
    console.log("Iterator.prototype.map, form 2, is it an operand:", result === subject, result === callback);
    const again = subject.map(callback);
    console.log("Iterator.prototype.map, form 2, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.map, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.map, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.map, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.map, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.map, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.map, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.map, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.map, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.map, form 2: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce(callback, 2.5);
    console.log("Iterator.prototype.reduce, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.call(subject, callback, 2.5);
    console.log("Iterator.prototype.reduce, by call, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, by call, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, by call: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.apply(subject, [callback, 2.5]);
    console.log("Iterator.prototype.reduce, by apply, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, by apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, by apply: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.reduce, subject, [callback, 2.5]);
    console.log("Iterator.prototype.reduce, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, by Reflect.apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.bind(subject)(callback, 2.5);
    console.log("Iterator.prototype.reduce, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, by a bound function, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, by a bound function: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce(callback, "-");
    console.log("Iterator.prototype.reduce, form 6, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 6, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 6: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.call(subject, callback, "-");
    console.log("Iterator.prototype.reduce, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 6, by call, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 6, by call: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.apply(subject, [callback, "-"]);
    console.log("Iterator.prototype.reduce, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 6, by apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 6, by apply: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.reduce, subject, [callback, "-"]);
    console.log("Iterator.prototype.reduce, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 6, by Reflect.apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 6, by Reflect.apply: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.bind(subject)(callback, "-");
    console.log("Iterator.prototype.reduce, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 6, by a bound function, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = subject.reduce(callback, 2.5);
    console.log("Iterator.prototype.reduce, form 11, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 11, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 11: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.call(subject, callback, 2.5);
    console.log("Iterator.prototype.reduce, form 11, by call, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 11, by call, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 11, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.apply(subject, [callback, 2.5]);
    console.log("Iterator.prototype.reduce, form 11, by apply, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 11, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 11, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.reduce, subject, [callback, 2.5]);
    console.log("Iterator.prototype.reduce, form 11, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 11, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 11, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = subject.reduce.bind(subject)(callback, 2.5);
    console.log("Iterator.prototype.reduce, form 11, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.reduce, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.reduce, form 11, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Iterator.prototype.reduce, form 11, by a bound function: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    function callback() {
      return true;
    }
    const result = subject.some(callback);
    console.log("Iterator.prototype.some, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.some:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.some, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.some: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    function callback() {
      return true;
    }
    const result = subject.some(callback);
    console.log("Iterator.prototype.some, form 2, is it an operand:", result === subject, result === callback);
    console.log("Iterator.prototype.some, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.some, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Iterator.prototype.some, form 2: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    const result = subject.take(1.5);
    console.log("Iterator.prototype.take, is it an operand:", result === subject);
    const again = subject.take(1.5);
    console.log("Iterator.prototype.take, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.take:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.take, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.take, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.take, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.take, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.take, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.take, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.take, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.take: it threw", error instanceof Error);
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
    const subject = [item, item].values();
    const result = subject.take(1.5);
    console.log("Iterator.prototype.take, form 2, is it an operand:", result === subject);
    const again = subject.take(1.5);
    console.log("Iterator.prototype.take, form 2, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.take, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.take, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.take, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.take, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.take, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.take, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.take, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.take, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.take, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    const result = subject.take(1.5);
    console.log("Iterator.prototype.take, form 3, is it an operand:", result === subject);
    const again = subject.take(1.5);
    console.log("Iterator.prototype.take, form 3, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.take, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.take, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.take, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.take, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.take, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.take, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.take, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.take, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.take, form 3: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    const result = subject.toArray();
    console.log("Iterator.prototype.toArray, is it an operand:", result === subject);
    const again = subject.toArray();
    console.log("Iterator.prototype.toArray, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.toArray:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.toArray, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.toArray, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.toArray, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.toArray, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.toArray, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Iterator.prototype.toArray, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Iterator.prototype.toArray, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.toArray, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.toArray: it threw", error instanceof Error);
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
    const subject = [item, item].values();
    const result = subject.toArray();
    console.log("Iterator.prototype.toArray, form 2, is it an operand:", result === subject);
    const again = subject.toArray();
    console.log("Iterator.prototype.toArray, form 2, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.toArray, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.toArray, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.toArray, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.toArray, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.toArray, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.toArray, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Iterator.prototype.toArray, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Iterator.prototype.toArray, form 2, its length:", result.length === 0, result.length);
    console.log("Iterator.prototype.toArray, form 2[0]:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Iterator.prototype.toArray, form 2[0], the class:", Array.isArray(result[0]), result[0] instanceof Object, result[0] instanceof Array, result[0] instanceof Map, result[0] instanceof Set, result[0] instanceof Promise, result[0] instanceof Date, result[0] instanceof RegExp, result[0] instanceof Error, result[0] instanceof ArrayBuffer, result[0] instanceof Uint8Array, result[0] instanceof Function, ArrayBuffer.isView(result[0]));
    console.log("Iterator.prototype.toArray, form 2[0], above it:", Object.getPrototypeOf(result[0]) === Object.prototype, Object.getPrototypeOf(result[0]) === Array.prototype, Object.getPrototypeOf(result[0]) === null);
    console.log("Iterator.prototype.toArray, form 2[0], its state:", Object.isFrozen(result[0]), Object.isSealed(result[0]), Object.isExtensible(result[0]));
    console.log("Iterator.prototype.toArray, form 2[0], names in it:", "length" in result[0], "size" in result[0], "then" in result[0], "next" in result[0], "constructor" in result[0], Symbol.iterator in result[0]);
    console.log("Iterator.prototype.toArray, form 2[0], how many keys:", Object.keys(result[0]).length);
    {
      let asked = 0;
      for (const value of Object.values(result[0])) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2[0], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result[0])) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2[0], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result[0]) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2[0], by for-in:", typeof key === "string", typeof result[0][key] === "undefined", typeof result[0][key] === "boolean", typeof result[0][key] === "number", typeof result[0][key] === "string", typeof result[0][key] === "bigint", typeof result[0][key] === "symbol", typeof result[0][key] === "function", typeof result[0][key] === "object", result[0][key] === null);
      }
    }
    console.log("Iterator.prototype.toArray, form 2[0].size:", typeof result[0].size === "undefined", typeof result[0].size === "boolean", typeof result[0].size === "number", typeof result[0].size === "string", typeof result[0].size === "bigint", typeof result[0].size === "symbol", typeof result[0].size === "function", typeof result[0].size === "object", result[0].size === null);
    console.log("Iterator.prototype.toArray, form 2[0].size, the number:", Number.isInteger(result[0].size), result[0].size === result[0].size, result[0].size < 0, result[0].size > 2147483647, result[0].size < -2147483648, Object.is(result[0].size, -0), (result[0].size | 0) === result[0].size);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.toArray, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.toArray, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = [].values();
    const result = subject.toArray();
    console.log("Iterator.prototype.toArray, form 3, is it an operand:", result === subject);
    const again = subject.toArray();
    console.log("Iterator.prototype.toArray, form 3, does a second call answer the same thing:", result === again);
    console.log("Iterator.prototype.toArray, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Iterator.prototype.toArray, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Iterator.prototype.toArray, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Iterator.prototype.toArray, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Iterator.prototype.toArray, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Iterator.prototype.toArray, form 3, how many keys:", Object.keys(result).length);
    console.log("Iterator.prototype.toArray, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Iterator.prototype.toArray, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Iterator.prototype.toArray, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Iterator.prototype.toArray, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Iterator.prototype.toArray, form 3: it threw", error instanceof Error);
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
    const subject = [1.5, item, "two"].values();
    const result = subject[Symbol.dispose]();
    console.log("Iterator.prototype[Symbol.dispose], is it an operand:", result === subject);
    console.log("Iterator.prototype[Symbol.dispose]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Iterator.prototype[Symbol.dispose]: it threw", error instanceof Error);
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
    const subject = [item, item].values();
    const result = subject[Symbol.dispose]();
    console.log("Iterator.prototype[Symbol.dispose], form 2, is it an operand:", result === subject);
    console.log("Iterator.prototype[Symbol.dispose], form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Iterator.prototype[Symbol.dispose], form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
