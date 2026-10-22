// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.append("an", "-");
    console.log("URLSearchParams.prototype.append, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.append:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.append: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.append("an", "-");
    console.log("URLSearchParams.prototype.append, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.append, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.append, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.append(1.5, 2.5);
    console.log("URLSearchParams.prototype.append, form 3, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.append, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.append, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.append("an", 2.5);
    console.log("URLSearchParams.prototype.append, form 4, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.append, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.append, form 4: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.append(item, item);
    console.log("URLSearchParams.prototype.append, form 5, is it an operand:", result === subject, result === item, result === item);
    console.log("URLSearchParams.prototype.append, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.append, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.append(1.5, 2.5);
    console.log("URLSearchParams.prototype.append, form 6, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.append, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.append, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.delete("an", "-");
    console.log("URLSearchParams.prototype.delete, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.delete:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.delete: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.delete("an", "-");
    console.log("URLSearchParams.prototype.delete, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.delete, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.delete, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.delete(1.5, 2.5);
    console.log("URLSearchParams.prototype.delete, form 3, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.delete, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.delete, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.delete("an", 2.5);
    console.log("URLSearchParams.prototype.delete, form 4, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.delete, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.delete, form 4: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.delete(item, item);
    console.log("URLSearchParams.prototype.delete, form 5, is it an operand:", result === subject, result === item, result === item);
    console.log("URLSearchParams.prototype.delete, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.delete, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.delete(1.5, 2.5);
    console.log("URLSearchParams.prototype.delete, form 6, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.delete, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.delete, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.entries();
    console.log("URLSearchParams.prototype.entries, is it an operand:", result === subject);
    const again = subject.entries();
    console.log("URLSearchParams.prototype.entries, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.entries:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.entries, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.entries, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.entries, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.entries, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.entries, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.entries, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.entries, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.entries: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.entries();
    console.log("URLSearchParams.prototype.entries, form 2, is it an operand:", result === subject);
    const again = subject.entries();
    console.log("URLSearchParams.prototype.entries, form 2, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.entries, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.entries, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.entries, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.entries, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.entries, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.entries, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.entries, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.entries, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.entries, form 2: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, second);
    console.log("URLSearchParams.prototype.forEach, is it an operand:", result === subject, result === callback, result === second);
    console.log("URLSearchParams.prototype.forEach:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.forEach: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, 2.5);
    console.log("URLSearchParams.prototype.forEach, form 2, is it an operand:", result === subject, result === callback);
    console.log("URLSearchParams.prototype.forEach, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.forEach, form 2: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, item);
    console.log("URLSearchParams.prototype.forEach, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("URLSearchParams.prototype.forEach, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.forEach, form 3: it threw", error instanceof Error);
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
    const subject = new URLSearchParams();
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, second);
    console.log("URLSearchParams.prototype.forEach, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("URLSearchParams.prototype.forEach, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.forEach, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.get("an");
    console.log("URLSearchParams.prototype.get, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.get("an");
    console.log("URLSearchParams.prototype.get, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.get(1.5);
    console.log("URLSearchParams.prototype.get, form 3, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.get, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.get, form 3: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.get(item);
    console.log("URLSearchParams.prototype.get, form 4, is it an operand:", result === subject, result === item);
    console.log("URLSearchParams.prototype.get, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.get, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.get(1.5);
    console.log("URLSearchParams.prototype.get, form 5, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.get, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URLSearchParams.prototype.get, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.getAll("an");
    console.log("URLSearchParams.prototype.getAll, is it an operand:", result === subject);
    const again = subject.getAll("an");
    console.log("URLSearchParams.prototype.getAll, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.getAll:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.getAll, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.getAll, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.getAll, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.getAll, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.getAll, how many keys:", Object.keys(result).length);
    console.log("URLSearchParams.prototype.getAll, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("URLSearchParams.prototype.getAll, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.getAll, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.getAll, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.getAll: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.getAll("an");
    console.log("URLSearchParams.prototype.getAll, form 2, is it an operand:", result === subject);
    const again = subject.getAll("an");
    console.log("URLSearchParams.prototype.getAll, form 2, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.getAll, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.getAll, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.getAll, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.getAll, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.getAll, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.getAll, form 2, how many keys:", Object.keys(result).length);
    console.log("URLSearchParams.prototype.getAll, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("URLSearchParams.prototype.getAll, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.getAll, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.getAll, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.getAll, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.getAll(1.5);
    console.log("URLSearchParams.prototype.getAll, form 3, is it an operand:", result === subject);
    const again = subject.getAll(1.5);
    console.log("URLSearchParams.prototype.getAll, form 3, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.getAll, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.getAll, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.getAll, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.getAll, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.getAll, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.getAll, form 3, how many keys:", Object.keys(result).length);
    console.log("URLSearchParams.prototype.getAll, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("URLSearchParams.prototype.getAll, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.getAll, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.getAll, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.getAll, form 3: it threw", error instanceof Error);
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
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.getAll(item);
    console.log("URLSearchParams.prototype.getAll, form 4, is it an operand:", result === subject, result === item);
    const again = subject.getAll(item);
    console.log("URLSearchParams.prototype.getAll, form 4, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.getAll, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.getAll, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.getAll, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.getAll, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.getAll, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.getAll, form 4, how many keys:", Object.keys(result).length);
    console.log("URLSearchParams.prototype.getAll, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("URLSearchParams.prototype.getAll, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.getAll, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.getAll, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.getAll, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.getAll(1.5);
    console.log("URLSearchParams.prototype.getAll, form 5, is it an operand:", result === subject);
    const again = subject.getAll(1.5);
    console.log("URLSearchParams.prototype.getAll, form 5, does a second call answer the same thing:", result === again);
    console.log("URLSearchParams.prototype.getAll, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.getAll, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URLSearchParams.prototype.getAll, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URLSearchParams.prototype.getAll, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URLSearchParams.prototype.getAll, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URLSearchParams.prototype.getAll, form 5, how many keys:", Object.keys(result).length);
    console.log("URLSearchParams.prototype.getAll, form 5, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("URLSearchParams.prototype.getAll, form 5, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URLSearchParams.prototype.getAll, form 5, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URLSearchParams.prototype.getAll, form 5, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URLSearchParams.prototype.getAll, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams("first=1&second=two&first=3");
    const result = subject.has("an", "-");
    console.log("URLSearchParams.prototype.has, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.has:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.has, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URLSearchParams.prototype.has: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URLSearchParams();
    const result = subject.has("an", "-");
    console.log("URLSearchParams.prototype.has, form 2, is it an operand:", result === subject);
    console.log("URLSearchParams.prototype.has, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URLSearchParams.prototype.has, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URLSearchParams.prototype.has, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
