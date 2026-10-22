// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.bind(pattern)("an");
    console.log("RegExp.prototype.compile, form 6, by a bound function, is it an operand:", result === pattern);
    console.log("RegExp.prototype.compile, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 6, by a bound function, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 6, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 6, by a bound function: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile(item);
    console.log("RegExp.prototype.compile, form 11, is it an operand:", result === pattern, result === item);
    console.log("RegExp.prototype.compile, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 11, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 11, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 11, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 11, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 11, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 11, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 11: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.call(pattern, item);
    console.log("RegExp.prototype.compile, form 11, by call, is it an operand:", result === pattern, result === item);
    console.log("RegExp.prototype.compile, form 11, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 11, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 11, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 11, by call, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 11, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 11, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 11, by call, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 11, by call: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.apply(pattern, [item]);
    console.log("RegExp.prototype.compile, form 11, by apply, is it an operand:", result === pattern, result === item);
    console.log("RegExp.prototype.compile, form 11, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 11, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 11, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 11, by apply, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 11, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 11, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 11, by apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 11, by apply: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = Reflect.apply(pattern.compile, pattern, [item]);
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, is it an operand:", result === pattern, result === item);
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 11, by Reflect.apply: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.compile.bind(pattern)(item);
    console.log("RegExp.prototype.compile, form 11, by a bound function, is it an operand:", result === pattern, result === item);
    console.log("RegExp.prototype.compile, form 11, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.compile, form 11, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.compile, form 11, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.compile, form 11, by a bound function, its own class:", Object.getPrototypeOf(result) === RegExp.prototype, Reflect.getPrototypeOf(result) === RegExp.prototype, result.constructor === RegExp, Object.getPrototypeOf(result) === Object.getPrototypeOf(RegExp.prototype));
    console.log("RegExp.prototype.compile, form 11, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.compile, form 11, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.compile, form 11, by a bound function, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("RegExp.prototype.compile, form 11, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.dotAll;
    console.log("RegExp.prototype.dotAll, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.dotAll, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.dotAll, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.dotAll, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.exec("an");
    console.log("RegExp.prototype.exec, is it an operand:", result === pattern);
    const again = pattern.exec("an");
    console.log("RegExp.prototype.exec, does a second call answer the same thing:", result === again);
    console.log("RegExp.prototype.exec:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.exec, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype.exec, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype.exec, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype.exec, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype.exec, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RegExp.prototype.exec.index:", typeof result.index === "undefined", typeof result.index === "boolean", typeof result.index === "number", typeof result.index === "string", typeof result.index === "bigint", typeof result.index === "symbol", typeof result.index === "function", typeof result.index === "object", result.index === null);
    console.log("RegExp.prototype.exec.index, the number:", Number.isInteger(result.index), result.index === result.index, result.index < 0, result.index > 2147483647, result.index < -2147483648, Object.is(result.index, -0), (result.index | 0) === result.index);
    console.log("RegExp.prototype.exec.input:", typeof result.input === "undefined", typeof result.input === "boolean", typeof result.input === "number", typeof result.input === "string", typeof result.input === "bigint", typeof result.input === "symbol", typeof result.input === "function", typeof result.input === "object", result.input === null);
    console.log("RegExp.prototype.exec.input, the text:", result.input.length === 0, result.input === "");
    console.log("RegExp.prototype.exec.groups:", typeof result.groups === "undefined", typeof result.groups === "boolean", typeof result.groups === "number", typeof result.groups === "string", typeof result.groups === "bigint", typeof result.groups === "symbol", typeof result.groups === "function", typeof result.groups === "object", result.groups === null);
    console.log("RegExp.prototype.exec.groups, the class:", Array.isArray(result.groups), result.groups instanceof Object, result.groups instanceof Array, result.groups instanceof Map, result.groups instanceof Set, result.groups instanceof Promise, result.groups instanceof Date, result.groups instanceof RegExp, result.groups instanceof Error, result.groups instanceof ArrayBuffer, result.groups instanceof Uint8Array, result.groups instanceof Function, ArrayBuffer.isView(result.groups));
    console.log("RegExp.prototype.exec.groups, above it:", Object.getPrototypeOf(result.groups) === Object.prototype, Object.getPrototypeOf(result.groups) === Array.prototype, Object.getPrototypeOf(result.groups) === null);
    console.log("RegExp.prototype.exec.groups, its state:", Object.isFrozen(result.groups), Object.isSealed(result.groups), Object.isExtensible(result.groups));
    console.log("RegExp.prototype.exec.groups, names in it:", "length" in result.groups, "size" in result.groups, "then" in result.groups, "next" in result.groups, "constructor" in result.groups, Symbol.iterator in result.groups);
    console.log("RegExp.prototype.exec.groups, how many keys:", Object.keys(result.groups).length);
    {
      let asked = 0;
      for (const value of Object.values(result.groups)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec.groups, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.groups)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec.groups, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.groups) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec.groups, by for-in:", typeof key === "string", typeof result.groups[key] === "undefined", typeof result.groups[key] === "boolean", typeof result.groups[key] === "number", typeof result.groups[key] === "string", typeof result.groups[key] === "bigint", typeof result.groups[key] === "symbol", typeof result.groups[key] === "function", typeof result.groups[key] === "object", result.groups[key] === null);
      }
    }
    console.log("RegExp.prototype.exec.groups.rest:", typeof result.groups.rest === "undefined", typeof result.groups.rest === "boolean", typeof result.groups.rest === "number", typeof result.groups.rest === "string", typeof result.groups.rest === "bigint", typeof result.groups.rest === "symbol", typeof result.groups.rest === "function", typeof result.groups.rest === "object", result.groups.rest === null);
    console.log("RegExp.prototype.exec.groups.rest, the text:", result.groups.rest.length === 0, result.groups.rest === "");
    console.log("RegExp.prototype.exec.groups.none:", typeof result.groups.none === "undefined", typeof result.groups.none === "boolean", typeof result.groups.none === "number", typeof result.groups.none === "string", typeof result.groups.none === "bigint", typeof result.groups.none === "symbol", typeof result.groups.none === "function", typeof result.groups.none === "object", result.groups.none === null);
    console.log("RegExp.prototype.exec, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("RegExp.prototype.exec, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype.exec, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("RegExp.prototype.exec, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("RegExp.prototype.exec: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.flags;
    console.log("RegExp.prototype.flags, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.flags, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.flags, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.prototype.flags, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.global;
    console.log("RegExp.prototype.global, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.global, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.global, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.global, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.hasIndices;
    console.log("RegExp.prototype.hasIndices, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.hasIndices, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.hasIndices, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.hasIndices, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.ignoreCase;
    console.log("RegExp.prototype.ignoreCase, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.ignoreCase, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.ignoreCase, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.ignoreCase, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.lastIndex;
    console.log("RegExp.prototype.lastIndex, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.lastIndex, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 9007199254740991));
    console.log("RegExp.prototype.lastIndex, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.lastIndex, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("RegExp.prototype.lastIndex, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.multiline;
    console.log("RegExp.prototype.multiline, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.multiline, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.multiline, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.multiline, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.source;
    console.log("RegExp.prototype.source, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.source, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.source, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.prototype.source, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.sticky;
    console.log("RegExp.prototype.sticky, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.sticky, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.sticky, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.sticky, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.test("an");
    console.log("RegExp.prototype.test, is it an operand:", result === pattern);
    console.log("RegExp.prototype.test:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.test, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.test: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.toString();
    console.log("RegExp.prototype.toString, is it an operand:", result === pattern);
    console.log("RegExp.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.unicode;
    console.log("RegExp.prototype.unicode, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.unicode, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.unicode, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.unicode, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern.unicodeSets;
    console.log("RegExp.prototype.unicodeSets, get, is it an operand:", result === pattern);
    console.log("RegExp.prototype.unicodeSets, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype.unicodeSets, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("RegExp.prototype.unicodeSets, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.match]("an");
    console.log("RegExp.prototype[Symbol.match], is it an operand:", result === pattern);
    console.log("RegExp.prototype[Symbol.match]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.match], the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype[Symbol.match], above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype[Symbol.match], its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype[Symbol.match], names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype[Symbol.match], how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.match], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.match], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.match], by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RegExp.prototype[Symbol.match], by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("RegExp.prototype[Symbol.match], its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.match], by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("RegExp.prototype[Symbol.match], by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("RegExp.prototype[Symbol.match]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.matchAll]("an");
    console.log("RegExp.prototype[Symbol.matchAll], is it an operand:", result === pattern);
    const again = pattern[Symbol.matchAll]("an");
    console.log("RegExp.prototype[Symbol.matchAll], does a second call answer the same thing:", result === again);
    console.log("RegExp.prototype[Symbol.matchAll]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.matchAll], the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype[Symbol.matchAll], above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype[Symbol.matchAll], its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype[Symbol.matchAll], names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype[Symbol.matchAll], how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.matchAll], by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("RegExp.prototype[Symbol.matchAll], by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("RegExp.prototype[Symbol.matchAll]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.replace]("an", 2.5);
    console.log("RegExp.prototype[Symbol.replace], is it an operand:", result === pattern);
    console.log("RegExp.prototype[Symbol.replace]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.replace], the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.prototype[Symbol.replace]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.replace]("an", "-");
    console.log("RegExp.prototype[Symbol.replace], form 2, is it an operand:", result === pattern);
    console.log("RegExp.prototype[Symbol.replace], form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.replace], form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.prototype[Symbol.replace], form 2: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.replace]("an", item);
    console.log("RegExp.prototype[Symbol.replace], form 3, is it an operand:", result === pattern, result === item);
    console.log("RegExp.prototype[Symbol.replace], form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.replace], form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RegExp.prototype[Symbol.replace], form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.search]("an");
    console.log("RegExp.prototype[Symbol.search], is it an operand:", result === pattern);
    console.log("RegExp.prototype[Symbol.search]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.search], the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("RegExp.prototype[Symbol.search]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.split]("an", 2.5);
    console.log("RegExp.prototype[Symbol.split], is it an operand:", result === pattern);
    const again = pattern[Symbol.split]("an", 2.5);
    console.log("RegExp.prototype[Symbol.split], does a second call answer the same thing:", result === again);
    console.log("RegExp.prototype[Symbol.split]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.split], the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype[Symbol.split], above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype[Symbol.split], its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype[Symbol.split], names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype[Symbol.split], how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.split], by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.split], by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.split], by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("RegExp.prototype[Symbol.split], by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("RegExp.prototype[Symbol.split], its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.split], by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("RegExp.prototype[Symbol.split], by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("RegExp.prototype[Symbol.split]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.split]("an", "-");
    console.log("RegExp.prototype[Symbol.split], form 2, is it an operand:", result === pattern);
    const again = pattern[Symbol.split]("an", "-");
    console.log("RegExp.prototype[Symbol.split], form 2, does a second call answer the same thing:", result === again);
    console.log("RegExp.prototype[Symbol.split], form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.split], form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype[Symbol.split], form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype[Symbol.split], form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype[Symbol.split], form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype[Symbol.split], form 2, how many keys:", Object.keys(result).length);
    console.log("RegExp.prototype[Symbol.split], form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("RegExp.prototype[Symbol.split], form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.split], form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("RegExp.prototype[Symbol.split], form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("RegExp.prototype[Symbol.split], form 2: it threw", error instanceof Error);
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
    const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = pattern[Symbol.split]("an", item);
    console.log("RegExp.prototype[Symbol.split], form 3, is it an operand:", result === pattern, result === item);
    const again = pattern[Symbol.split]("an", item);
    console.log("RegExp.prototype[Symbol.split], form 3, does a second call answer the same thing:", result === again);
    console.log("RegExp.prototype[Symbol.split], form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RegExp.prototype[Symbol.split], form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("RegExp.prototype[Symbol.split], form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("RegExp.prototype[Symbol.split], form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("RegExp.prototype[Symbol.split], form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("RegExp.prototype[Symbol.split], form 3, how many keys:", Object.keys(result).length);
    console.log("RegExp.prototype[Symbol.split], form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("RegExp.prototype[Symbol.split], form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("RegExp.prototype[Symbol.split], form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("RegExp.prototype[Symbol.split], form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("RegExp.prototype[Symbol.split], form 3: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
