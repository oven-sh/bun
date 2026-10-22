// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.arrayBuffer();
    console.log("Blob.prototype.arrayBuffer, is it an operand:", result === subject);
    const again = subject.arrayBuffer();
    console.log("Blob.prototype.arrayBuffer, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.arrayBuffer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.arrayBuffer, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.arrayBuffer, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.arrayBuffer, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.arrayBuffer, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.arrayBuffer, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.arrayBuffer, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.arrayBuffer, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.arrayBuffer, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Blob.prototype.arrayBuffer, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Blob.prototype.arrayBuffer, settled, its own class:", Object.getPrototypeOf(settled) === ArrayBuffer.prototype, Reflect.getPrototypeOf(settled) === ArrayBuffer.prototype, settled.constructor === ArrayBuffer, Object.getPrototypeOf(settled) === Object.getPrototypeOf(ArrayBuffer.prototype));
      console.log("Blob.prototype.arrayBuffer, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Blob.prototype.arrayBuffer, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Blob.prototype.arrayBuffer, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Blob.prototype.arrayBuffer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.arrayBuffer();
    console.log("Blob.prototype.arrayBuffer, form 2, is it an operand:", result === subject);
    const again = subject.arrayBuffer();
    console.log("Blob.prototype.arrayBuffer, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.arrayBuffer, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.arrayBuffer, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.arrayBuffer, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.arrayBuffer, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.arrayBuffer, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.arrayBuffer, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.arrayBuffer, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.arrayBuffer, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.arrayBuffer, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Blob.prototype.arrayBuffer, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Blob.prototype.arrayBuffer, form 2, settled, its own class:", Object.getPrototypeOf(settled) === ArrayBuffer.prototype, Reflect.getPrototypeOf(settled) === ArrayBuffer.prototype, settled.constructor === ArrayBuffer, Object.getPrototypeOf(settled) === Object.getPrototypeOf(ArrayBuffer.prototype));
      console.log("Blob.prototype.arrayBuffer, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Blob.prototype.arrayBuffer, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Blob.prototype.arrayBuffer, form 2, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Blob.prototype.arrayBuffer, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.bytes();
    console.log("Blob.prototype.bytes, is it an operand:", result === subject);
    const again = subject.bytes();
    console.log("Blob.prototype.bytes, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.bytes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.bytes, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.bytes, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.bytes, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.bytes, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.bytes, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.bytes, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.bytes, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.bytes, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Blob.prototype.bytes, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Blob.prototype.bytes, settled, its own class:", Object.getPrototypeOf(settled) === Uint8Array.prototype, Reflect.getPrototypeOf(settled) === Uint8Array.prototype, settled.constructor === Uint8Array, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Blob.prototype.bytes, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Blob.prototype.bytes, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Blob.prototype.bytes, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.bytes, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.bytes, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.bytes, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Blob.prototype.bytes, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Blob.prototype.bytes, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.bytes, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Blob.prototype.bytes, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Blob.prototype.bytes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.bytes();
    console.log("Blob.prototype.bytes, form 2, is it an operand:", result === subject);
    const again = subject.bytes();
    console.log("Blob.prototype.bytes, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.bytes, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.bytes, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.bytes, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.bytes, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.bytes, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.bytes, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.bytes, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.bytes, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.bytes, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Blob.prototype.bytes, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Blob.prototype.bytes, form 2, settled, its own class:", Object.getPrototypeOf(settled) === Uint8Array.prototype, Reflect.getPrototypeOf(settled) === Uint8Array.prototype, settled.constructor === Uint8Array, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Blob.prototype.bytes, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Blob.prototype.bytes, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Blob.prototype.bytes, form 2, settled, how many keys:", Object.keys(settled).length);
      console.log("Blob.prototype.bytes, form 2, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Blob.prototype.bytes, form 2, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.bytes, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Blob.prototype.bytes, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Blob.prototype.bytes, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.exists();
    console.log("Blob.prototype.exists, is it an operand:", result === subject);
    const again = subject.exists();
    console.log("Blob.prototype.exists, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.exists:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.exists, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.exists, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.exists, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.exists, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.exists, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.exists, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.exists, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.exists, settled, the boolean:", settled === true, settled === false, !settled);
    }
  } catch (error) {
    console.log("Blob.prototype.exists: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.exists();
    console.log("Blob.prototype.exists, form 2, is it an operand:", result === subject);
    const again = subject.exists();
    console.log("Blob.prototype.exists, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.exists, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.exists, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.exists, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.exists, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.exists, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.exists, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.exists, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.exists, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.exists, form 2, settled, the boolean:", settled === true, settled === false, !settled);
    }
  } catch (error) {
    console.log("Blob.prototype.exists, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.formData();
    console.log("Blob.prototype.formData, is it an operand:", result === subject);
    const again = subject.formData();
    console.log("Blob.prototype.formData, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.formData:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.formData, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.formData, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.formData, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.formData, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.formData, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.formData, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.formData: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.formData();
    console.log("Blob.prototype.formData, form 2, is it an operand:", result === subject);
    const again = subject.formData();
    console.log("Blob.prototype.formData, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.formData, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.formData, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.formData, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.formData, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.formData, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.formData, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.formData, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.formData, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.formData, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Blob.prototype.formData, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Blob.prototype.formData, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Blob.prototype.formData, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Blob.prototype.formData, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.formData, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Blob.prototype.formData, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Blob.prototype.formData, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.image(1.5);
    console.log("Blob.prototype.image, is it an operand:", result === subject);
    const again = subject.image(1.5);
    console.log("Blob.prototype.image, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.image:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.image, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.image, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.image, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.image, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.image, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.image: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.image("an");
    console.log("Blob.prototype.image, form 2, is it an operand:", result === subject);
    const again = subject.image("an");
    console.log("Blob.prototype.image, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.image, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.image, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.image, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.image, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.image, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.image, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.image, form 2: it threw", error instanceof Error);
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
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.image(item);
    console.log("Blob.prototype.image, form 3, is it an operand:", result === subject, result === item);
    const again = subject.image(item);
    console.log("Blob.prototype.image, form 3, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.image, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.image, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.image, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.image, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.image, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.image, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.image, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.json();
    console.log("Blob.prototype.json, is it an operand:", result === subject);
    const again = subject.json();
    console.log("Blob.prototype.json, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.json:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.json, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.json, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.json, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.json, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.json, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.json, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.json, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.json, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Blob.prototype.json, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Blob.prototype.json, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Blob.prototype.json, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Blob.prototype.json, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.json, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.json, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.json, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Blob.prototype.json, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Blob.prototype.json, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Blob.prototype.json, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Blob.prototype.json, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Blob.prototype.json: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.json();
    console.log("Blob.prototype.json, form 2, is it an operand:", result === subject);
    const again = subject.json();
    console.log("Blob.prototype.json, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.json, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.json, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.json, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.json, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.json, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.json, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.json, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.json, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.lastModified;
    console.log("Blob.prototype.lastModified, get, is it an operand:", result === subject);
    console.log("Blob.prototype.lastModified, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.lastModified, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Blob.prototype.lastModified, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.lastModified;
    console.log("Blob.prototype.lastModified, get, form 2, is it an operand:", result === subject);
    console.log("Blob.prototype.lastModified, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.lastModified, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Blob.prototype.lastModified, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.name;
    console.log("Blob.prototype.name, get, is it an operand:", result === subject);
    console.log("Blob.prototype.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Blob.prototype.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.name;
    console.log("Blob.prototype.name, get, form 2, is it an operand:", result === subject);
    console.log("Blob.prototype.name, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Blob.prototype.name, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.size;
    console.log("Blob.prototype.size, get, is it an operand:", result === subject);
    console.log("Blob.prototype.size, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.size, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Blob.prototype.size, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.size;
    console.log("Blob.prototype.size, get, form 2, is it an operand:", result === subject);
    console.log("Blob.prototype.size, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.size, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Blob.prototype.size, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.slice(1.5, 2.5, 3.5);
    console.log("Blob.prototype.slice, is it an operand:", result === subject);
    const again = subject.slice(1.5, 2.5, 3.5);
    console.log("Blob.prototype.slice, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.slice:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.slice, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.slice, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.slice, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Blob.prototype.slice, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.slice, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.slice, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.slice: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.slice("an", 2.5, 3.5);
    console.log("Blob.prototype.slice, form 2, is it an operand:", result === subject);
    const again = subject.slice("an", 2.5, 3.5);
    console.log("Blob.prototype.slice, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.slice, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.slice, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.slice, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.slice, form 2, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Blob.prototype.slice, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.slice, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.slice, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.slice, form 2: it threw", error instanceof Error);
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
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.slice(item, item, item);
    console.log("Blob.prototype.slice, form 3, is it an operand:", result === subject, result === item, result === item, result === item);
    const again = subject.slice(item, item, item);
    console.log("Blob.prototype.slice, form 3, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.slice, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.slice, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.slice, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.slice, form 3, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Blob.prototype.slice, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.slice, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.slice, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.slice, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.slice(1.5, 2.5, 3.5);
    console.log("Blob.prototype.slice, form 4, is it an operand:", result === subject);
    const again = subject.slice(1.5, 2.5, 3.5);
    console.log("Blob.prototype.slice, form 4, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.slice, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.slice, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.slice, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.slice, form 4, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Blob.prototype.slice, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.slice, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.slice, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.slice, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.stat();
    console.log("Blob.prototype.stat, is it an operand:", result === subject);
    const again = subject.stat();
    console.log("Blob.prototype.stat, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.stat:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Blob.prototype.stat: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.stat();
    console.log("Blob.prototype.stat, form 2, is it an operand:", result === subject);
    const again = subject.stat();
    console.log("Blob.prototype.stat, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.stat, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Blob.prototype.stat, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.stream(1.5);
    console.log("Blob.prototype.stream, is it an operand:", result === subject);
    console.log("Blob.prototype.stream:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.stream, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.stream, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.stream, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.stream, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.stream, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.stream: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.stream(1.5);
    console.log("Blob.prototype.stream, form 2, is it an operand:", result === subject);
    console.log("Blob.prototype.stream, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.stream, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.stream, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.stream, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.stream, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.stream, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Blob.prototype.stream, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.text();
    console.log("Blob.prototype.text, is it an operand:", result === subject);
    const again = subject.text();
    console.log("Blob.prototype.text, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.text:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.text, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.text, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.text, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.text, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.text, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.text, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.text, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.text, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Blob.prototype.text: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob([]);
    const result = subject.text();
    console.log("Blob.prototype.text, form 2, is it an operand:", result === subject);
    const again = subject.text();
    console.log("Blob.prototype.text, form 2, does a second call answer the same thing:", result === again);
    console.log("Blob.prototype.text, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.text, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Blob.prototype.text, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Blob.prototype.text, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Blob.prototype.text, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Blob.prototype.text, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Blob.prototype.text, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Blob.prototype.text, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Blob.prototype.text, form 2, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Blob.prototype.text, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
    const result = subject.type;
    console.log("Blob.prototype.type, get, is it an operand:", result === subject);
    console.log("Blob.prototype.type, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Blob.prototype.type, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Blob.prototype.type, get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
