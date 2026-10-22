// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.append("an", "-");
    console.log("Headers.prototype.append, is it an operand:", result === subject);
    console.log("Headers.prototype.append:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.append: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.append("an", "-");
    console.log("Headers.prototype.append, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.append, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.append, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.append(1.5, 2.5);
    console.log("Headers.prototype.append, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.append, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.append, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.append("an", 2.5);
    console.log("Headers.prototype.append, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.append, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.append, form 4: it threw", error instanceof Error);
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
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.append(1.5, item);
    console.log("Headers.prototype.append, form 5, is it an operand:", result === subject, result === item);
    console.log("Headers.prototype.append, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.append, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.append(1.5, 2.5);
    console.log("Headers.prototype.append, form 6, is it an operand:", result === subject);
    console.log("Headers.prototype.append, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.append, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.count;
    console.log("Headers.prototype.count, get, is it an operand:", result === subject);
    console.log("Headers.prototype.count, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Headers.prototype.count, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.count, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Headers.prototype.count, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.count;
    console.log("Headers.prototype.count, get, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.count, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Headers.prototype.count, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.count, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Headers.prototype.count, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.count;
    console.log("Headers.prototype.count, get, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.count, get, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.count, get, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Headers.prototype.count, get, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.count;
    console.log("Headers.prototype.count, get, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.count, get, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.count, get, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Headers.prototype.count, get, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.delete("an");
    console.log("Headers.prototype.delete, is it an operand:", result === subject);
    console.log("Headers.prototype.delete:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.delete: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.delete("an");
    console.log("Headers.prototype.delete, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.delete, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.delete, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.delete(1.5);
    console.log("Headers.prototype.delete, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.delete, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.delete, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.delete(1.5);
    console.log("Headers.prototype.delete, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.delete, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.delete, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.entries();
    console.log("Headers.prototype.entries, is it an operand:", result === subject);
    const again = subject.entries();
    console.log("Headers.prototype.entries, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.entries:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.entries, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.entries, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.entries, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.entries, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.entries, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.entries, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.entries, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.entries: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.entries();
    console.log("Headers.prototype.entries, form 2, is it an operand:", result === subject);
    const again = subject.entries();
    console.log("Headers.prototype.entries, form 2, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.entries, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.entries, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.entries, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.entries, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.entries, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.entries, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.entries, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.entries, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.entries, form 2: it threw", error instanceof Error);
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
    const subject = new Headers({ first: "1", second: "two" });
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, second);
    console.log("Headers.prototype.forEach, is it an operand:", result === subject, result === callback, result === second);
    console.log("Headers.prototype.forEach:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.forEach: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, 2.5);
    console.log("Headers.prototype.forEach, form 2, is it an operand:", result === subject, result === callback);
    console.log("Headers.prototype.forEach, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.forEach, form 2: it threw", error instanceof Error);
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
    const subject = new Headers({ first: "1", second: "two" });
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, item);
    console.log("Headers.prototype.forEach, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("Headers.prototype.forEach, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.forEach, form 3: it threw", error instanceof Error);
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
    const subject = new Headers();
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, second);
    console.log("Headers.prototype.forEach, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("Headers.prototype.forEach, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.forEach, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.get("an");
    console.log("Headers.prototype.get, is it an operand:", result === subject);
    console.log("Headers.prototype.get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.get("an");
    console.log("Headers.prototype.get, form 2, is it an operand:", result === subject);
    console.log("Headers.prototype.get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.get(1.5);
    console.log("Headers.prototype.get, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.get, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.get, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.get(1.5);
    console.log("Headers.prototype.get, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.get, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Headers.prototype.get, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.getAll("Set-Cookie");
    console.log("Headers.prototype.getAll, is it an operand:", result === subject);
    const again = subject.getAll("Set-Cookie");
    console.log("Headers.prototype.getAll, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.getAll:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.getAll, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.getAll, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.getAll, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.getAll, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.getAll, how many keys:", Object.keys(result).length);
    console.log("Headers.prototype.getAll, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Headers.prototype.getAll, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.getAll, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.getAll, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.getAll: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.getAll("Set-Cookie");
    console.log("Headers.prototype.getAll, form 2, is it an operand:", result === subject);
    const again = subject.getAll("Set-Cookie");
    console.log("Headers.prototype.getAll, form 2, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.getAll, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.getAll, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.getAll, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.getAll, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.getAll, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.getAll, form 2, how many keys:", Object.keys(result).length);
    console.log("Headers.prototype.getAll, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Headers.prototype.getAll, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.getAll, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.getAll, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.getAll, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.getSetCookie();
    console.log("Headers.prototype.getSetCookie, is it an operand:", result === subject);
    const again = subject.getSetCookie();
    console.log("Headers.prototype.getSetCookie, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.getSetCookie:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.getSetCookie, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.getSetCookie, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.getSetCookie, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.getSetCookie, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.getSetCookie, how many keys:", Object.keys(result).length);
    console.log("Headers.prototype.getSetCookie, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Headers.prototype.getSetCookie, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.getSetCookie, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.getSetCookie, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.getSetCookie: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.getSetCookie();
    console.log("Headers.prototype.getSetCookie, form 2, is it an operand:", result === subject);
    const again = subject.getSetCookie();
    console.log("Headers.prototype.getSetCookie, form 2, does a second call answer the same thing:", result === again);
    console.log("Headers.prototype.getSetCookie, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.getSetCookie, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.getSetCookie, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.getSetCookie, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.getSetCookie, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.getSetCookie, form 2, how many keys:", Object.keys(result).length);
    console.log("Headers.prototype.getSetCookie, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Headers.prototype.getSetCookie, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.getSetCookie, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.getSetCookie, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.getSetCookie, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers({ first: "1", second: "two" });
    const result = subject.getSetCookie();
    console.log("Headers.prototype.getSetCookie, form 3, is it an operand:", result === subject);
    console.log("Headers.prototype.getSetCookie, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.getSetCookie, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.getSetCookie, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.getSetCookie, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.getSetCookie, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.getSetCookie, form 3, how many keys:", Object.keys(result).length);
    console.log("Headers.prototype.getSetCookie, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Headers.prototype.getSetCookie, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.getSetCookie, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.getSetCookie, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.getSetCookie, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Headers();
    const result = subject.getSetCookie();
    console.log("Headers.prototype.getSetCookie, form 4, is it an operand:", result === subject);
    console.log("Headers.prototype.getSetCookie, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Headers.prototype.getSetCookie, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Headers.prototype.getSetCookie, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Headers.prototype.getSetCookie, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Headers.prototype.getSetCookie, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Headers.prototype.getSetCookie, form 4, how many keys:", Object.keys(result).length);
    console.log("Headers.prototype.getSetCookie, form 4, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Headers.prototype.getSetCookie, form 4, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Headers.prototype.getSetCookie, form 4, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Headers.prototype.getSetCookie, form 4, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Headers.prototype.getSetCookie, form 4: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
