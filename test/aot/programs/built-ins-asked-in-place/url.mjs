// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = URL.canParse("an", "-");
    console.log("URL.canParse:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.canParse, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URL.canParse: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.canParse("an", "-");
    console.log("URL.canParse, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.canParse, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URL.canParse, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.canParse(1.5, 2.5);
    console.log("URL.canParse, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.canParse, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URL.canParse, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.canParse("an", 2.5);
    console.log("URL.canParse, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.canParse, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URL.canParse, form 4: it threw", error instanceof Error);
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
    const result = URL.canParse(item, item);
    console.log("URL.canParse, form 5, is it an operand:", result === item, result === item);
    console.log("URL.canParse, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.canParse, form 5, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("URL.canParse, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.parse("an", "-");
    const again = URL.parse("an", "-");
    console.log("URL.parse, does a second call answer the same thing:", result === again);
    console.log("URL.parse:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URL.parse: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.parse("an", "-");
    const again = URL.parse("an", "-");
    console.log("URL.parse, form 2, does a second call answer the same thing:", result === again);
    console.log("URL.parse, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URL.parse, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.parse(1.5, 2.5);
    const again = URL.parse(1.5, 2.5);
    console.log("URL.parse, form 3, does a second call answer the same thing:", result === again);
    console.log("URL.parse, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URL.parse, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = URL.parse("an", 2.5);
    const again = URL.parse("an", 2.5);
    console.log("URL.parse, form 4, does a second call answer the same thing:", result === again);
    console.log("URL.parse, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URL.parse, form 4: it threw", error instanceof Error);
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
    const result = URL.parse(item, item);
    console.log("URL.parse, form 5, is it an operand:", result === item, result === item);
    const again = URL.parse(item, item);
    console.log("URL.parse, form 5, does a second call answer the same thing:", result === again);
    console.log("URL.parse, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("URL.parse, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.hash;
    console.log("URL.prototype.hash, get, is it an operand:", result === subject);
    console.log("URL.prototype.hash, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.hash, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.hash, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.host;
    console.log("URL.prototype.host, get, is it an operand:", result === subject);
    console.log("URL.prototype.host, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.host, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.host, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.hostname;
    console.log("URL.prototype.hostname, get, is it an operand:", result === subject);
    console.log("URL.prototype.hostname, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.hostname, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.hostname, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.href;
    console.log("URL.prototype.href, get, is it an operand:", result === subject);
    console.log("URL.prototype.href, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.href, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.href, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.origin;
    console.log("URL.prototype.origin, get, is it an operand:", result === subject);
    console.log("URL.prototype.origin, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.origin, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.origin, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.password;
    console.log("URL.prototype.password, get, is it an operand:", result === subject);
    console.log("URL.prototype.password, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.password, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.password, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.pathname;
    console.log("URL.prototype.pathname, get, is it an operand:", result === subject);
    console.log("URL.prototype.pathname, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.pathname, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.pathname, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.port;
    console.log("URL.prototype.port, get, is it an operand:", result === subject);
    console.log("URL.prototype.port, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.port, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.port, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.protocol;
    console.log("URL.prototype.protocol, get, is it an operand:", result === subject);
    console.log("URL.prototype.protocol, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.protocol, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.protocol, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.search;
    console.log("URL.prototype.search, get, is it an operand:", result === subject);
    console.log("URL.prototype.search, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.search, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.search, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.searchParams;
    console.log("URL.prototype.searchParams, get, is it an operand:", result === subject);
    console.log("URL.prototype.searchParams, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.searchParams, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("URL.prototype.searchParams, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("URL.prototype.searchParams, get, its own class:", Object.getPrototypeOf(result) === URLSearchParams.prototype, Reflect.getPrototypeOf(result) === URLSearchParams.prototype, result.constructor === URLSearchParams, Object.getPrototypeOf(result) === Object.getPrototypeOf(URLSearchParams.prototype));
    console.log("URL.prototype.searchParams, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("URL.prototype.searchParams, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("URL.prototype.searchParams, get, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("URL.prototype.searchParams, get, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("URL.prototype.searchParams, get, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("URL.prototype.searchParams, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.toJSON();
    console.log("URL.prototype.toJSON, is it an operand:", result === subject);
    console.log("URL.prototype.toJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.toJSON, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.toJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.toString();
    console.log("URL.prototype.toString, is it an operand:", result === subject);
    console.log("URL.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject.username;
    console.log("URL.prototype.username, get, is it an operand:", result === subject);
    console.log("URL.prototype.username, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype.username, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype.username, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
    const result = subject[Symbol.toStringTag];
    console.log("URL.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("URL.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("URL.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("URL.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
