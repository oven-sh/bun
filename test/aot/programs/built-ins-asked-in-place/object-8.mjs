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
    const subject = { first: item, second: item };
    function callback() {
      return true;
    }
    const result = subject.__defineSetter__("an", callback);
    console.log("Object.prototype.__defineSetter__, form 2, is it an operand:", result === subject, result === callback);
    console.log("Object.prototype.__defineSetter__, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__defineSetter__, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    function callback() {
      return true;
    }
    const result = subject.__defineSetter__("an", callback);
    console.log("Object.prototype.__defineSetter__, form 3, is it an operand:", result === subject, result === callback);
    console.log("Object.prototype.__defineSetter__, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__defineSetter__, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.__lookupGetter__("an");
    console.log("Object.prototype.__lookupGetter__, is it an operand:", result === subject);
    console.log("Object.prototype.__lookupGetter__:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__lookupGetter__: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.__lookupGetter__("an");
    console.log("Object.prototype.__lookupGetter__, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.__lookupGetter__, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__lookupGetter__, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.__lookupGetter__("an");
    console.log("Object.prototype.__lookupGetter__, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.__lookupGetter__, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__lookupGetter__, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.__lookupSetter__("an");
    console.log("Object.prototype.__lookupSetter__, is it an operand:", result === subject);
    console.log("Object.prototype.__lookupSetter__:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__lookupSetter__: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.__lookupSetter__("an");
    console.log("Object.prototype.__lookupSetter__, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.__lookupSetter__, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__lookupSetter__, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.__lookupSetter__("an");
    console.log("Object.prototype.__lookupSetter__, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.__lookupSetter__, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.__lookupSetter__, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.__proto__;
    console.log("Object.prototype.__proto__, get, is it an operand:", result === subject);
    console.log("Object.prototype.__proto__, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.__proto__, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.__proto__, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.__proto__, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.__proto__, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.__proto__, get: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.__proto__;
    console.log("Object.prototype.__proto__, get, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.__proto__, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.__proto__, get, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.__proto__, get, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.__proto__, get, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.__proto__, get, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.__proto__, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.__proto__;
    console.log("Object.prototype.__proto__, get, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.__proto__, get, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.__proto__, get, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.__proto__, get, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.__proto__, get, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.__proto__, get, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Object.prototype.__proto__, get, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.hasOwnProperty("an");
    console.log("Object.prototype.hasOwnProperty, is it an operand:", result === subject);
    console.log("Object.prototype.hasOwnProperty:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.hasOwnProperty, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.hasOwnProperty: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.hasOwnProperty("an");
    console.log("Object.prototype.hasOwnProperty, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.hasOwnProperty, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.hasOwnProperty, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.hasOwnProperty, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.hasOwnProperty("an");
    console.log("Object.prototype.hasOwnProperty, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.hasOwnProperty, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.hasOwnProperty, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.hasOwnProperty, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.isPrototypeOf(1.5);
    console.log("Object.prototype.isPrototypeOf, is it an operand:", result === subject);
    console.log("Object.prototype.isPrototypeOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.isPrototypeOf, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.isPrototypeOf: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.isPrototypeOf("an");
    console.log("Object.prototype.isPrototypeOf, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.isPrototypeOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.isPrototypeOf, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.isPrototypeOf, form 2: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.isPrototypeOf(item);
    console.log("Object.prototype.isPrototypeOf, form 3, is it an operand:", result === subject, result === item);
    console.log("Object.prototype.isPrototypeOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.isPrototypeOf, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.isPrototypeOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.isPrototypeOf(1.5);
    console.log("Object.prototype.isPrototypeOf, form 4, is it an operand:", result === subject);
    console.log("Object.prototype.isPrototypeOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.isPrototypeOf, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.isPrototypeOf, form 4: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.propertyIsEnumerable("an");
    console.log("Object.prototype.propertyIsEnumerable, is it an operand:", result === subject);
    console.log("Object.prototype.propertyIsEnumerable:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.propertyIsEnumerable, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.propertyIsEnumerable: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.propertyIsEnumerable("an");
    console.log("Object.prototype.propertyIsEnumerable, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.propertyIsEnumerable, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.propertyIsEnumerable, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.propertyIsEnumerable, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.propertyIsEnumerable("an");
    console.log("Object.prototype.propertyIsEnumerable, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.propertyIsEnumerable, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.propertyIsEnumerable, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Object.prototype.propertyIsEnumerable, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.toLocaleString();
    console.log("Object.prototype.toLocaleString, is it an operand:", result === subject);
    console.log("Object.prototype.toLocaleString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.toLocaleString: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.toLocaleString();
    console.log("Object.prototype.toLocaleString, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.toLocaleString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.toLocaleString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.toLocaleString();
    console.log("Object.prototype.toLocaleString, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.toLocaleString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Object.prototype.toLocaleString, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.toString();
    console.log("Object.prototype.toString, is it an operand:", result === subject);
    console.log("Object.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Object.prototype.toString: it threw", error instanceof Error);
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
    const subject = { first: item, second: item };
    const result = subject.toString();
    console.log("Object.prototype.toString, form 2, is it an operand:", result === subject);
    console.log("Object.prototype.toString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.toString, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Object.prototype.toString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = {};
    const result = subject.toString();
    console.log("Object.prototype.toString, form 3, is it an operand:", result === subject);
    console.log("Object.prototype.toString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.toString, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Object.prototype.toString, form 3: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.valueOf();
    console.log("Object.prototype.valueOf, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.prototype.valueOf.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.prototype.valueOf.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.prototype.valueOf.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.prototype.valueOf.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.prototype.valueOf.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.prototype.valueOf.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.prototype.valueOf.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.prototype.valueOf.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.prototype.valueOf.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.prototype.valueOf: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.valueOf.call(subject);
    console.log("Object.prototype.valueOf, by call, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.prototype.valueOf, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.prototype.valueOf, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.prototype.valueOf, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.prototype.valueOf, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.prototype.valueOf, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.prototype.valueOf, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.prototype.valueOf, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.prototype.valueOf, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, by call: it threw", error instanceof Error);
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
    const subject = { first: 1.5, second: "two", third: item };
    const result = subject.valueOf.apply(subject, []);
    console.log("Object.prototype.valueOf, by apply, is it an operand:", result === subject);
    console.log("Object.prototype.valueOf, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Object.prototype.valueOf, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Object.prototype.valueOf, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Object.prototype.valueOf, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Object.prototype.valueOf, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Object.prototype.valueOf, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Object.prototype.valueOf, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Object.prototype.valueOf, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Object.prototype.valueOf, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Object.prototype.valueOf, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Object.prototype.valueOf, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Object.prototype.valueOf, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Object.prototype.valueOf, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Object.prototype.valueOf, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Object.prototype.valueOf, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Object.prototype.valueOf, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Object.prototype.valueOf, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Object.prototype.valueOf, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Object.prototype.valueOf, by apply: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
