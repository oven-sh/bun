// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Uint8Array.BYTES_PER_ELEMENT;
    console.log("Uint8Array.BYTES_PER_ELEMENT, get, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 1));
    console.log("Uint8Array.BYTES_PER_ELEMENT, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.BYTES_PER_ELEMENT, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Uint8Array.BYTES_PER_ELEMENT, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Uint8Array.fromBase64("YmFuYW5h");
    const again = Uint8Array.fromBase64("YmFuYW5h");
    console.log("Uint8Array.fromBase64, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.fromBase64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.fromBase64, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.fromBase64, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.fromBase64, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Uint8Array.fromBase64, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.fromBase64, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.fromBase64, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.fromBase64, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Uint8Array.fromBase64, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Uint8Array.fromBase64, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Uint8Array.fromBase64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Uint8Array.fromBase64("YmFuYW5h");
    const again = Uint8Array.fromBase64("YmFuYW5h");
    console.log("Uint8Array.fromBase64, form 2, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.fromBase64, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.fromBase64, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.fromBase64, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.fromBase64, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Uint8Array.fromBase64, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.fromBase64, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.fromBase64, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.fromBase64, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Uint8Array.fromBase64, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromBase64, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Uint8Array.fromBase64, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Uint8Array.fromBase64, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Uint8Array.fromHex("ff01");
    const again = Uint8Array.fromHex("ff01");
    console.log("Uint8Array.fromHex, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.fromHex:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.fromHex, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.fromHex, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.fromHex, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Uint8Array.fromHex, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.fromHex, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.fromHex, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.fromHex, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Uint8Array.fromHex, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Uint8Array.fromHex, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Uint8Array.fromHex: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Uint8Array.fromHex("ff01");
    const again = Uint8Array.fromHex("ff01");
    console.log("Uint8Array.fromHex, form 2, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.fromHex, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.fromHex, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.fromHex, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.fromHex, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Uint8Array.fromHex, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.fromHex, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.fromHex, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.fromHex, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Uint8Array.fromHex, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.fromHex, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Uint8Array.fromHex, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Uint8Array.fromHex, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Uint8Array.length;
    console.log("Uint8Array.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Uint8Array.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Uint8Array.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Uint8Array.name;
    console.log("Uint8Array.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Uint8Array.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.BYTES_PER_ELEMENT;
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, is it an operand:", result === subject);
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 1));
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.BYTES_PER_ELEMENT;
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, form 2, is it an operand:", result === subject);
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 1 && result <= 1));
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Uint8Array.prototype.BYTES_PER_ELEMENT, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.setFromBase64("an");
    console.log("Uint8Array.prototype.setFromBase64, is it an operand:", result === subject);
    const again = subject.setFromBase64("an");
    console.log("Uint8Array.prototype.setFromBase64, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.prototype.setFromBase64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.setFromBase64, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.prototype.setFromBase64, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.prototype.setFromBase64, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.prototype.setFromBase64, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.prototype.setFromBase64, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromBase64, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromBase64, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromBase64, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.prototype.setFromBase64.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Uint8Array.prototype.setFromBase64.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Uint8Array.prototype.setFromBase64.written:", typeof result.written === "undefined", typeof result.written === "boolean", typeof result.written === "number", typeof result.written === "string", typeof result.written === "bigint", typeof result.written === "symbol", typeof result.written === "function", typeof result.written === "object", result.written === null);
    console.log("Uint8Array.prototype.setFromBase64.written, the number:", Number.isInteger(result.written), result.written === result.written, result.written < 0, result.written > 2147483647, result.written < -2147483648, Object.is(result.written, -0), (result.written | 0) === result.written);
  } catch (error) {
    console.log("Uint8Array.prototype.setFromBase64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.setFromBase64("an");
    console.log("Uint8Array.prototype.setFromBase64, form 2, is it an operand:", result === subject);
    const again = subject.setFromBase64("an");
    console.log("Uint8Array.prototype.setFromBase64, form 2, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.prototype.setFromBase64, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.setFromBase64, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.prototype.setFromBase64, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.prototype.setFromBase64, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.prototype.setFromBase64, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.prototype.setFromBase64, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromBase64, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromBase64, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromBase64, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.prototype.setFromBase64, form 2.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Uint8Array.prototype.setFromBase64, form 2.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Uint8Array.prototype.setFromBase64, form 2.written:", typeof result.written === "undefined", typeof result.written === "boolean", typeof result.written === "number", typeof result.written === "string", typeof result.written === "bigint", typeof result.written === "symbol", typeof result.written === "function", typeof result.written === "object", result.written === null);
    console.log("Uint8Array.prototype.setFromBase64, form 2.written, the number:", Number.isInteger(result.written), result.written === result.written, result.written < 0, result.written > 2147483647, result.written < -2147483648, Object.is(result.written, -0), (result.written | 0) === result.written);
  } catch (error) {
    console.log("Uint8Array.prototype.setFromBase64, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.setFromHex("an");
    console.log("Uint8Array.prototype.setFromHex, is it an operand:", result === subject);
    const again = subject.setFromHex("an");
    console.log("Uint8Array.prototype.setFromHex, does a second call answer the same thing:", result === again);
    console.log("Uint8Array.prototype.setFromHex:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.setFromHex, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Uint8Array.prototype.setFromHex, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Uint8Array.prototype.setFromHex, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Uint8Array.prototype.setFromHex, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Uint8Array.prototype.setFromHex, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromHex, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromHex, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Uint8Array.prototype.setFromHex, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Uint8Array.prototype.setFromHex.read:", typeof result.read === "undefined", typeof result.read === "boolean", typeof result.read === "number", typeof result.read === "string", typeof result.read === "bigint", typeof result.read === "symbol", typeof result.read === "function", typeof result.read === "object", result.read === null);
    console.log("Uint8Array.prototype.setFromHex.read, the number:", Number.isInteger(result.read), result.read === result.read, result.read < 0, result.read > 2147483647, result.read < -2147483648, Object.is(result.read, -0), (result.read | 0) === result.read);
    console.log("Uint8Array.prototype.setFromHex.written:", typeof result.written === "undefined", typeof result.written === "boolean", typeof result.written === "number", typeof result.written === "string", typeof result.written === "bigint", typeof result.written === "symbol", typeof result.written === "function", typeof result.written === "object", result.written === null);
    console.log("Uint8Array.prototype.setFromHex.written, the number:", Number.isInteger(result.written), result.written === result.written, result.written < 0, result.written > 2147483647, result.written < -2147483648, Object.is(result.written, -0), (result.written | 0) === result.written);
  } catch (error) {
    console.log("Uint8Array.prototype.setFromHex: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toBase64();
    console.log("Uint8Array.prototype.toBase64, is it an operand:", result === subject);
    console.log("Uint8Array.prototype.toBase64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.toBase64, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Uint8Array.prototype.toBase64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.toBase64();
    console.log("Uint8Array.prototype.toBase64, form 2, is it an operand:", result === subject);
    console.log("Uint8Array.prototype.toBase64, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.toBase64, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Uint8Array.prototype.toBase64, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.toHex();
    console.log("Uint8Array.prototype.toHex, is it an operand:", result === subject);
    console.log("Uint8Array.prototype.toHex:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.toHex, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Uint8Array.prototype.toHex: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.toHex();
    console.log("Uint8Array.prototype.toHex, form 2, is it an operand:", result === subject);
    console.log("Uint8Array.prototype.toHex, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Uint8Array.prototype.toHex, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Uint8Array.prototype.toHex, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
