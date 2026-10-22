// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Response.error();
    const again = Response.error();
    console.log("Response.error, does a second call answer the same thing:", result === again);
    console.log("Response.error:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.error, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.error, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.error, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.error, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.error, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.error, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.error: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.error();
    const again = Response.error();
    console.log("Response.error, form 2, does a second call answer the same thing:", result === again);
    console.log("Response.error, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.error, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.error, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.error, form 2, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.error, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.error, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.error, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.error, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.json(null, null);
    const again = Response.json(null, null);
    console.log("Response.json, does a second call answer the same thing:", result === again);
    console.log("Response.json:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.json(null, null);
    const again = Response.json(null, null);
    console.log("Response.json, form 2, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 2, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.json(1.5, null);
    const again = Response.json(1.5, null);
    console.log("Response.json, form 3, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 3, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.json("an", null);
    const again = Response.json("an", null);
    console.log("Response.json, form 4, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 4, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 4: it threw", error instanceof Error);
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
    const result = Response.json(item, null);
    console.log("Response.json, form 5, is it an operand:", result === item);
    const again = Response.json(item, null);
    console.log("Response.json, form 5, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 5, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.json(1.5, 2.5);
    const again = Response.json(1.5, 2.5);
    console.log("Response.json, form 6, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 6, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.json("an", 2.5);
    const again = Response.json("an", 2.5);
    console.log("Response.json, form 7, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 7, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 7, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 7, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 7, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 7, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 7, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 7: it threw", error instanceof Error);
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
    const result = Response.json(item, item);
    console.log("Response.json, form 8, is it an operand:", result === item, result === item);
    const again = Response.json(item, item);
    console.log("Response.json, form 8, does a second call answer the same thing:", result === again);
    console.log("Response.json, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.json, form 8, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.json, form 8, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.json, form 8, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.json, form 8, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.json, form 8, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.json, form 8, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.json, form 8: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.redirect("an", null);
    const again = Response.redirect("an", null);
    console.log("Response.redirect, does a second call answer the same thing:", result === again);
    console.log("Response.redirect:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.redirect, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.redirect, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.redirect, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.redirect, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.redirect, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.redirect, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.redirect: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.redirect("an", null);
    const again = Response.redirect("an", null);
    console.log("Response.redirect, form 2, does a second call answer the same thing:", result === again);
    console.log("Response.redirect, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.redirect, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.redirect, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.redirect, form 2, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.redirect, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.redirect, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.redirect, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.redirect, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Response.redirect("an", "-");
    const again = Response.redirect("an", "-");
    console.log("Response.redirect, form 3, does a second call answer the same thing:", result === again);
    console.log("Response.redirect, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.redirect, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.redirect, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.redirect, form 3, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.redirect, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.redirect, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.redirect, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.redirect, form 3: it threw", error instanceof Error);
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
    const result = Response.redirect("an", second);
    console.log("Response.redirect, form 4, is it an operand:", result === second);
    const again = Response.redirect("an", second);
    console.log("Response.redirect, form 4, does a second call answer the same thing:", result === again);
    console.log("Response.redirect, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.redirect, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.redirect, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.redirect, form 4, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.redirect, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.redirect, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.redirect, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.redirect, form 4: it threw", error instanceof Error);
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
    const result = Response.redirect("an", item);
    console.log("Response.redirect, form 5, is it an operand:", result === item);
    const again = Response.redirect("an", item);
    console.log("Response.redirect, form 5, does a second call answer the same thing:", result === again);
    console.log("Response.redirect, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.redirect, form 5, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.redirect, form 5, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.redirect, form 5, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.redirect, form 5, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.redirect, form 5, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.redirect, form 5, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.redirect, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.arrayBuffer();
    console.log("Response.prototype.arrayBuffer, is it an operand:", result === subject);
    const again = subject.arrayBuffer();
    console.log("Response.prototype.arrayBuffer, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.arrayBuffer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.arrayBuffer, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.arrayBuffer, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.arrayBuffer, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Response.prototype.arrayBuffer, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.arrayBuffer, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.arrayBuffer, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Response.prototype.arrayBuffer, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Response.prototype.arrayBuffer, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Response.prototype.arrayBuffer, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Response.prototype.arrayBuffer, settled, its own class:", Object.getPrototypeOf(settled) === ArrayBuffer.prototype, Reflect.getPrototypeOf(settled) === ArrayBuffer.prototype, settled.constructor === ArrayBuffer, Object.getPrototypeOf(settled) === Object.getPrototypeOf(ArrayBuffer.prototype));
      console.log("Response.prototype.arrayBuffer, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Response.prototype.arrayBuffer, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Response.prototype.arrayBuffer, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Response.prototype.arrayBuffer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.blob();
    console.log("Response.prototype.blob, is it an operand:", result === subject);
    const again = subject.blob();
    console.log("Response.prototype.blob, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.blob:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.blob, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.blob, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.blob, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Response.prototype.blob, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.blob, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.blob, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Response.prototype.blob, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Response.prototype.blob, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Response.prototype.blob, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Response.prototype.blob, settled, its own class:", Object.getPrototypeOf(settled) === Blob.prototype, Reflect.getPrototypeOf(settled) === Blob.prototype, settled.constructor === Blob, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Blob.prototype));
      console.log("Response.prototype.blob, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Response.prototype.blob, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Response.prototype.blob, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Response.prototype.blob: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.body;
    console.log("Response.prototype.body, get, is it an operand:", result === subject);
    console.log("Response.prototype.body, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.body, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.body, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.body, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.body, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.body, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.prototype.body, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.bodyUsed;
    console.log("Response.prototype.bodyUsed, get, is it an operand:", result === subject);
    console.log("Response.prototype.bodyUsed, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.bodyUsed, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Response.prototype.bodyUsed, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.bytes();
    console.log("Response.prototype.bytes, is it an operand:", result === subject);
    const again = subject.bytes();
    console.log("Response.prototype.bytes, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.bytes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.bytes, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.bytes, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.bytes, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Response.prototype.bytes, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.bytes, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.bytes, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Response.prototype.bytes, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Response.prototype.bytes, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Response.prototype.bytes, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Response.prototype.bytes, settled, its own class:", Object.getPrototypeOf(settled) === Uint8Array.prototype, Reflect.getPrototypeOf(settled) === Uint8Array.prototype, settled.constructor === Uint8Array, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Response.prototype.bytes, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Response.prototype.bytes, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Response.prototype.bytes, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Response.prototype.bytes, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Response.prototype.bytes, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Response.prototype.bytes, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Response.prototype.bytes, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Response.prototype.bytes, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Response.prototype.bytes, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Response.prototype.bytes, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Response.prototype.bytes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.clone();
    console.log("Response.prototype.clone, is it an operand:", result === subject);
    const again = subject.clone();
    console.log("Response.prototype.clone, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.clone:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.clone, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.clone, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.clone, its own class:", Object.getPrototypeOf(result) === Response.prototype, Reflect.getPrototypeOf(result) === Response.prototype, result.constructor === Response, Object.getPrototypeOf(result) === Object.getPrototypeOf(Response.prototype));
    console.log("Response.prototype.clone, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.clone, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.clone, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.prototype.clone: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.formData();
    console.log("Response.prototype.formData, is it an operand:", result === subject);
    const again = subject.formData();
    console.log("Response.prototype.formData, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.formData:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.formData, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.formData, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.formData, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Response.prototype.formData, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.formData, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.formData, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.prototype.formData: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.headers;
    console.log("Response.prototype.headers, get, is it an operand:", result === subject);
    console.log("Response.prototype.headers, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.headers, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.headers, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.headers, get, its own class:", Object.getPrototypeOf(result) === Headers.prototype, Reflect.getPrototypeOf(result) === Headers.prototype, result.constructor === Headers, Object.getPrototypeOf(result) === Object.getPrototypeOf(Headers.prototype));
    console.log("Response.prototype.headers, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.headers, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.headers, get, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Response.prototype.headers, get, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Response.prototype.headers, get, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Response.prototype.headers, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.json();
    console.log("Response.prototype.json, is it an operand:", result === subject);
    const again = subject.json();
    console.log("Response.prototype.json, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.json:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.json, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.json, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.json, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Response.prototype.json, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.json, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.json, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Response.prototype.json, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Response.prototype.json, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Response.prototype.json, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Response.prototype.json, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Response.prototype.json, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Response.prototype.json, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Response.prototype.json, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Response.prototype.json, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Response.prototype.json, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Response.prototype.json, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Response.prototype.json, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Response.prototype.json, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Response.prototype.json, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Response.prototype.json: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.ok;
    console.log("Response.prototype.ok, get, is it an operand:", result === subject);
    console.log("Response.prototype.ok, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.ok, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Response.prototype.ok, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.redirected;
    console.log("Response.prototype.redirected, get, is it an operand:", result === subject);
    console.log("Response.prototype.redirected, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.redirected, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Response.prototype.redirected, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.status;
    console.log("Response.prototype.status, get, is it an operand:", result === subject);
    console.log("Response.prototype.status, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.status, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Response.prototype.status, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.statusText;
    console.log("Response.prototype.statusText, get, is it an operand:", result === subject);
    console.log("Response.prototype.statusText, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.statusText, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Response.prototype.statusText, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.text();
    console.log("Response.prototype.text, is it an operand:", result === subject);
    const again = subject.text();
    console.log("Response.prototype.text, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.text:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.text, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.text, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.text, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Response.prototype.text, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.text, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.text, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Response.prototype.text, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Response.prototype.text, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Response.prototype.text: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.textStream();
    console.log("Response.prototype.textStream, is it an operand:", result === subject);
    const again = subject.textStream();
    console.log("Response.prototype.textStream, does a second call answer the same thing:", result === again);
    console.log("Response.prototype.textStream:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.textStream, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Response.prototype.textStream, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Response.prototype.textStream, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Response.prototype.textStream, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Response.prototype.textStream, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Response.prototype.textStream: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
