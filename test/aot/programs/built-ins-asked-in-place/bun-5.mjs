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
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToFormData(first, item);
    console.log("Bun.readableStreamToFormData, form 3, is it an operand:", result === first, result === item);
    const again = Bun.readableStreamToFormData(first, item);
    console.log("Bun.readableStreamToFormData, form 3, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToFormData, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToFormData, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToFormData, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToFormData, form 3, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToFormData, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToFormData, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToFormData, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.readableStreamToFormData, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToFormData(first, 2.5);
    console.log("Bun.readableStreamToFormData, form 4, is it an operand:", result === first);
    const again = Bun.readableStreamToFormData(first, 2.5);
    console.log("Bun.readableStreamToFormData, form 4, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToFormData, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToFormData, form 4, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToFormData, form 4, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToFormData, form 4, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToFormData, form 4, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToFormData, form 4, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToFormData, form 4, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.readableStreamToFormData, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToJSON(first);
    console.log("Bun.readableStreamToJSON, is it an operand:", result === first);
    const again = Bun.readableStreamToJSON(first);
    console.log("Bun.readableStreamToJSON, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToJSON, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToJSON, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToJSON, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToJSON, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToJSON, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToJSON, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToJSON, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToJSON, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToJSON, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToJSON, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToJSON, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToJSON, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Bun.readableStreamToJSON, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToJSON, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Bun.readableStreamToJSON, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Bun.readableStreamToJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToJSON(first);
    console.log("Bun.readableStreamToJSON, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToJSON(first);
    console.log("Bun.readableStreamToJSON, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToJSON, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToJSON, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToJSON, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToJSON, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToJSON, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToJSON, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToJSON, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToJSON, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToJSON, form 2, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Bun.readableStreamToJSON, form 2, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Bun.readableStreamToJSON, form 2, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Bun.readableStreamToJSON, form 2, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Bun.readableStreamToJSON, form 2, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, form 2, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, form 2, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, form 2, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Bun.readableStreamToJSON, form 2, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Bun.readableStreamToJSON, form 2, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Bun.readableStreamToJSON, form 2, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Bun.readableStreamToJSON, form 2, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Bun.readableStreamToJSON, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToText(first);
    console.log("Bun.readableStreamToText, is it an operand:", result === first);
    const again = Bun.readableStreamToText(first);
    console.log("Bun.readableStreamToText, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToText:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToText, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToText, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToText, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToText, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToText, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToText, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToText, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToText, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Bun.readableStreamToText: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
    const result = Bun.readableStreamToText(first);
    console.log("Bun.readableStreamToText, form 2, is it an operand:", result === first);
    const again = Bun.readableStreamToText(first);
    console.log("Bun.readableStreamToText, form 2, does a second call answer the same thing:", result === again);
    console.log("Bun.readableStreamToText, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.readableStreamToText, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.readableStreamToText, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.readableStreamToText, form 2, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Bun.readableStreamToText, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.readableStreamToText, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.readableStreamToText, form 2, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Bun.readableStreamToText, form 2, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Bun.readableStreamToText, form 2, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Bun.readableStreamToText, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.revision;
    console.log("Bun.revision, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.revision, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.sha(first);
    console.log("Bun.sha, is it an operand:", result === first);
    console.log("Bun.sha:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sha, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.sha, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.sha, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.sha, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.sha, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.sha, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.sha, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.sha, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.sha, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.sha, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.sha, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.sha, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.sha, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.sha: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.sha(first);
    console.log("Bun.sha, form 2, is it an operand:", result === first);
    console.log("Bun.sha, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sha, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.sha, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.sha, form 2, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.sha, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.sha, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.sha, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.sha, form 2, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.sha, form 2, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.sha, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.sha, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.sha(first);
    console.log("Bun.sha, form 3, is it an operand:", result === first);
    console.log("Bun.sha, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sha, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.sha, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.sha, form 3, its own class:", Object.getPrototypeOf(result) === Uint8Array.prototype, Reflect.getPrototypeOf(result) === Uint8Array.prototype, result.constructor === Uint8Array, Object.getPrototypeOf(result) === Object.getPrototypeOf(Uint8Array.prototype));
    console.log("Bun.sha, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.sha, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.sha, form 3, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 3, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 3, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 3, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.sha, form 3, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.sha, form 3, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.sha, form 3, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.sha, form 3, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.sha, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.sliceAnsi("an", 2.5, 3.5, 4.5, 5.5);
    console.log("Bun.sliceAnsi:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sliceAnsi, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.sliceAnsi: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.sliceAnsi("an", "-", 3.5, 4.5, 5.5);
    console.log("Bun.sliceAnsi, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sliceAnsi, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.sliceAnsi, form 2: it threw", error instanceof Error);
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
    const result = Bun.sliceAnsi("an", item, item, item, item);
    console.log("Bun.sliceAnsi, form 3, is it an operand:", result === item, result === item, result === item, result === item);
    console.log("Bun.sliceAnsi, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sliceAnsi, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.sliceAnsi, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.sliceAnsi("an", 2.5, 3.5, 4.5, 5.5);
    console.log("Bun.sliceAnsi, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.sliceAnsi, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.sliceAnsi, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stderr;
    console.log("Bun.stderr, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stderr, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.stderr, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.stderr, get, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Bun.stderr, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.stderr, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.stderr, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stdin;
    console.log("Bun.stdin, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stdin, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.stdin, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.stdin, get, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Bun.stdin, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.stdin, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.stdin, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stdout;
    console.log("Bun.stdout, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stdout, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.stdout, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.stdout, get, its own class:", Object.getPrototypeOf(result) === Blob.prototype, Reflect.getPrototypeOf(result) === Blob.prototype, result.constructor === Blob, Object.getPrototypeOf(result) === Object.getPrototypeOf(Blob.prototype));
    console.log("Bun.stdout, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.stdout, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Bun.stdout, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stringWidth("an", null);
    console.log("Bun.stringWidth, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Bun.stringWidth:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stringWidth, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.stringWidth: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stringWidth("an", null);
    console.log("Bun.stringWidth, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Bun.stringWidth, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stringWidth, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.stringWidth, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stringWidth("an", 2.5);
    console.log("Bun.stringWidth, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Bun.stringWidth, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stringWidth, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.stringWidth, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stringWidth("an", "-");
    console.log("Bun.stringWidth, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Bun.stringWidth, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stringWidth, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.stringWidth, form 4: it threw", error instanceof Error);
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
    const result = Bun.stringWidth("an", item);
    console.log("Bun.stringWidth, form 5, is it an operand:", result === item);
    console.log("Bun.stringWidth, form 5, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967296));
    console.log("Bun.stringWidth, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stringWidth, form 5, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.stringWidth, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stripANSI("an");
    console.log("Bun.stripANSI:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stripANSI, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.stripANSI: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.stripANSI("an");
    console.log("Bun.stripANSI, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.stripANSI, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.stripANSI, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.version;
    console.log("Bun.version, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.version, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.wrapAnsi("an", 2.5, 3.5);
    console.log("Bun.wrapAnsi:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.wrapAnsi, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.wrapAnsi: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.wrapAnsi("an", "-", 3.5);
    console.log("Bun.wrapAnsi, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.wrapAnsi, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.wrapAnsi, form 2: it threw", error instanceof Error);
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
    const result = Bun.wrapAnsi("an", item, item);
    console.log("Bun.wrapAnsi, form 3, is it an operand:", result === item, result === item);
    console.log("Bun.wrapAnsi, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.wrapAnsi, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.wrapAnsi, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.wrapAnsi("an", 2.5, 3.5);
    console.log("Bun.wrapAnsi, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.wrapAnsi, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Bun.wrapAnsi, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.zstdCompressSync(first);
    console.log("Bun.zstdCompressSync, is it an operand:", result === first);
    console.log("Bun.zstdCompressSync:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.zstdCompressSync, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Bun.zstdCompressSync, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Bun.zstdCompressSync, its own class:", Object.getPrototypeOf(result) === Buffer.prototype, Reflect.getPrototypeOf(result) === Buffer.prototype, result.constructor === Buffer, Object.getPrototypeOf(result) === Object.getPrototypeOf(Buffer.prototype));
    console.log("Bun.zstdCompressSync, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Bun.zstdCompressSync, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Bun.zstdCompressSync, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Bun.zstdCompressSync, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Bun.zstdCompressSync, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Bun.zstdCompressSync, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Bun.zstdCompressSync, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("Bun.zstdCompressSync, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Bun.zstdCompressSync, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Bun.zstdCompressSync, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Bun.zstdCompressSync: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
