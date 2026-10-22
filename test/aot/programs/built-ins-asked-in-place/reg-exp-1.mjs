// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = RegExp.$1;
    console.log("RegExp.$1, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$1, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$1, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$2;
    console.log("RegExp.$2, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$2, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$2, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$3;
    console.log("RegExp.$3, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$3, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$3, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$4;
    console.log("RegExp.$4, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$4, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$4, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$5;
    console.log("RegExp.$5, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$5, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$5, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$6;
    console.log("RegExp.$6, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$6, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$6, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$7;
    console.log("RegExp.$7, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$7, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$7, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$8;
    console.log("RegExp.$8, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$8, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$8, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$9;
    console.log("RegExp.$9, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$9, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$9, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.$_;
    console.log("RegExp.$_, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.$_, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.$_, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.escape("an");
    console.log("RegExp.escape:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.escape, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.escape: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.escape("an");
    console.log("RegExp.escape, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.escape, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.escape, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.input;
    console.log("RegExp.input, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.input, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.input, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.lastMatch;
    console.log("RegExp.lastMatch, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.lastMatch, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.lastMatch, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.lastParen;
    console.log("RegExp.lastParen, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.lastParen, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.lastParen, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.leftContext;
    console.log("RegExp.leftContext, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.leftContext, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.leftContext, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.length;
    console.log("RegExp.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("RegExp.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("RegExp.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.multiline;
    console.log("RegExp.multiline, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.multiline, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.multiline, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.name;
    console.log("RegExp.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp.rightContext;
    console.log("RegExp.rightContext, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.rightContext, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.rightContext, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RegExp[Symbol.species];
    console.log("RegExp[Symbol.species], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp[Symbol.species], get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp[Symbol.species], get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp[Symbol.species], get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp[Symbol.species], get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp[Symbol.species], get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile(1.5);
    console.log("RegExp.prototype.compile, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.call(pattern, 1.5);
    console.log("RegExp.prototype.compile, by call, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, by call, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.apply(pattern, [1.5]);
    console.log("RegExp.prototype.compile, by apply, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, by apply, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = Reflect.apply(pattern.compile, pattern, [1.5]);
    console.log("RegExp.prototype.compile, by Reflect.apply, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.bind(pattern)(1.5);
    console.log("RegExp.prototype.compile, by a bound function, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, by a bound function, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile("an");
    console.log("RegExp.prototype.compile, form 6, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 6, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 6, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.call(pattern, "an");
    console.log("RegExp.prototype.compile, form 6, by call, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 6, by call, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 6, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.apply(pattern, ["an"]);
    console.log("RegExp.prototype.compile, form 6, by apply, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 6, by apply, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 6, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = Reflect.apply(pattern.compile, pattern, ["an"]);
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
