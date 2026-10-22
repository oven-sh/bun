// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.arrayBuffer();
    console.log("Request.prototype.arrayBuffer, is it an operand:", result === subject);
    const again = subject.arrayBuffer();
    console.log("Request.prototype.arrayBuffer, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.arrayBuffer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.arrayBuffer, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.arrayBuffer, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.arrayBuffer, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Request.prototype.arrayBuffer, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.arrayBuffer, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.arrayBuffer, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Request.prototype.arrayBuffer, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Request.prototype.arrayBuffer, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Request.prototype.arrayBuffer, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Request.prototype.arrayBuffer, settled, its own class:", Object.getPrototypeOf(settled) === ArrayBuffer.prototype, Reflect.getPrototypeOf(settled) === ArrayBuffer.prototype, settled.constructor === ArrayBuffer, Object.getPrototypeOf(settled) === Object.getPrototypeOf(ArrayBuffer.prototype));
      console.log("Request.prototype.arrayBuffer, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Request.prototype.arrayBuffer, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Request.prototype.arrayBuffer, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Request.prototype.arrayBuffer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.blob();
    console.log("Request.prototype.blob, is it an operand:", result === subject);
    const again = subject.blob();
    console.log("Request.prototype.blob, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.blob:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.blob, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.blob, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.blob, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Request.prototype.blob, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.blob, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.blob, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Request.prototype.blob, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Request.prototype.blob, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Request.prototype.blob, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Request.prototype.blob, settled, its own class:", Object.getPrototypeOf(settled) === Blob.prototype, Reflect.getPrototypeOf(settled) === Blob.prototype, settled.constructor === Blob, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Blob.prototype));
      console.log("Request.prototype.blob, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Request.prototype.blob, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Request.prototype.blob, settled, how many keys:", Object.keys(settled).length);
    }
  } catch (error) {
    console.log("Request.prototype.blob: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.body;
    console.log("Request.prototype.body, get, is it an operand:", result === subject);
    console.log("Request.prototype.body, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.body, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.body, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.body, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.body, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.body, get, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Request.prototype.body, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.bodyUsed;
    console.log("Request.prototype.bodyUsed, get, is it an operand:", result === subject);
    console.log("Request.prototype.bodyUsed, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.bodyUsed, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Request.prototype.bodyUsed, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.bytes();
    console.log("Request.prototype.bytes, is it an operand:", result === subject);
    const again = subject.bytes();
    console.log("Request.prototype.bytes, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.bytes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.bytes, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.bytes, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.bytes, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Request.prototype.bytes, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.bytes, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.bytes, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Request.prototype.bytes, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Request.prototype.bytes, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Request.prototype.bytes, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Request.prototype.bytes, settled, its own class:", Object.getPrototypeOf(settled) === Uint8Array.prototype, Reflect.getPrototypeOf(settled) === Uint8Array.prototype, settled.constructor === Uint8Array, Object.getPrototypeOf(settled) === Object.getPrototypeOf(Uint8Array.prototype));
      console.log("Request.prototype.bytes, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Request.prototype.bytes, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Request.prototype.bytes, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Request.prototype.bytes, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Request.prototype.bytes, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Request.prototype.bytes, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Request.prototype.bytes, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Request.prototype.bytes, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Request.prototype.bytes, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Request.prototype.bytes, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Request.prototype.bytes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.cache;
    console.log("Request.prototype.cache, get, is it an operand:", result === subject);
    console.log("Request.prototype.cache, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.cache, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.cache, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.credentials;
    console.log("Request.prototype.credentials, get, is it an operand:", result === subject);
    console.log("Request.prototype.credentials, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.credentials, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.credentials, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.destination;
    console.log("Request.prototype.destination, get, is it an operand:", result === subject);
    console.log("Request.prototype.destination, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.destination, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.destination, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.formData();
    console.log("Request.prototype.formData, is it an operand:", result === subject);
    const again = subject.formData();
    console.log("Request.prototype.formData, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.formData:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.formData, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.formData, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.formData, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Request.prototype.formData, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.formData, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.formData, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Request.prototype.formData: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.headers;
    console.log("Request.prototype.headers, get, is it an operand:", result === subject);
    console.log("Request.prototype.headers, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.headers, get, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.headers, get, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.headers, get, its own class:", Object.getPrototypeOf(result) === Headers.prototype, Reflect.getPrototypeOf(result) === Headers.prototype, result.constructor === Headers, Object.getPrototypeOf(result) === Object.getPrototypeOf(Headers.prototype));
    console.log("Request.prototype.headers, get, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.headers, get, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.headers, get, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("Request.prototype.headers, get, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("Request.prototype.headers, get, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("Request.prototype.headers, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.integrity;
    console.log("Request.prototype.integrity, get, is it an operand:", result === subject);
    console.log("Request.prototype.integrity, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.integrity, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.integrity, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.json();
    console.log("Request.prototype.json, is it an operand:", result === subject);
    const again = subject.json();
    console.log("Request.prototype.json, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.json:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.json, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.json, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.json, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Request.prototype.json, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.json, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.json, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Request.prototype.json, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Request.prototype.json, settled, the class:", Array.isArray(settled), settled instanceof Object, settled instanceof Array, settled instanceof Map, settled instanceof Set, settled instanceof Promise, settled instanceof Date, settled instanceof RegExp, settled instanceof Error, settled instanceof ArrayBuffer, settled instanceof Uint8Array, settled instanceof Function, ArrayBuffer.isView(settled));
      console.log("Request.prototype.json, settled, above it:", Object.getPrototypeOf(settled) === Object.prototype, Object.getPrototypeOf(settled) === Array.prototype, Object.getPrototypeOf(settled) === null);
      console.log("Request.prototype.json, settled, its state:", Object.isFrozen(settled), Object.isSealed(settled), Object.isExtensible(settled));
      console.log("Request.prototype.json, settled, names in it:", "length" in settled, "size" in settled, "then" in settled, "next" in settled, "constructor" in settled, Symbol.iterator in settled);
      console.log("Request.prototype.json, settled, how many keys:", Object.keys(settled).length);
      {
        let asked = 0;
        for (const value of Object.values(settled)) {
          if (asked++ === 4) break;
          console.log("Request.prototype.json, settled, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const [key, value] of Object.entries(settled)) {
          if (asked++ === 4) break;
          console.log("Request.prototype.json, settled, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
        }
      }
      {
        let asked = 0;
        for (const key in settled) {
          if (asked++ === 4) break;
          console.log("Request.prototype.json, settled, by for-in:", typeof key === "string", typeof settled[key] === "undefined", typeof settled[key] === "boolean", typeof settled[key] === "number", typeof settled[key] === "string", typeof settled[key] === "bigint", typeof settled[key] === "symbol", typeof settled[key] === "function", typeof settled[key] === "object", settled[key] === null);
        }
      }
      console.log("Request.prototype.json, settled, by index:", typeof settled[0] === "undefined", typeof settled[0] === "boolean", typeof settled[0] === "number", typeof settled[0] === "string", typeof settled[0] === "bigint", typeof settled[0] === "symbol", typeof settled[0] === "function", typeof settled[0] === "object", settled[0] === null);
      console.log("Request.prototype.json, settled, its length:", settled.length === 0, settled.length);
      {
        let asked = 0;
        for (const value of settled) {
          if (asked++ === 4) break;
          console.log("Request.prototype.json, settled, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
          if (Array.isArray(value)) console.log("Request.prototype.json, settled, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
        }
      }
    }
  } catch (error) {
    console.log("Request.prototype.json: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.method;
    console.log("Request.prototype.method, get, is it an operand:", result === subject);
    console.log("Request.prototype.method, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.method, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.method, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.mode;
    console.log("Request.prototype.mode, get, is it an operand:", result === subject);
    console.log("Request.prototype.mode, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.mode, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.mode, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.redirect;
    console.log("Request.prototype.redirect, get, is it an operand:", result === subject);
    console.log("Request.prototype.redirect, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.redirect, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.redirect, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.referrer;
    console.log("Request.prototype.referrer, get, is it an operand:", result === subject);
    console.log("Request.prototype.referrer, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.referrer, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.referrer, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.referrerPolicy;
    console.log("Request.prototype.referrerPolicy, get, is it an operand:", result === subject);
    console.log("Request.prototype.referrerPolicy, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.referrerPolicy, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.referrerPolicy, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.text();
    console.log("Request.prototype.text, is it an operand:", result === subject);
    const again = subject.text();
    console.log("Request.prototype.text, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.text:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.text, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.text, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.text, its own class:", Object.getPrototypeOf(result) === Promise.prototype, Reflect.getPrototypeOf(result) === Promise.prototype, result.constructor === Promise, Object.getPrototypeOf(result) === Object.getPrototypeOf(Promise.prototype));
    console.log("Request.prototype.text, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.text, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.text, how many keys:", Object.keys(result).length);
    {
      const settled = await result;
      console.log("Request.prototype.text, settled:", typeof settled === "undefined", typeof settled === "boolean", typeof settled === "number", typeof settled === "string", typeof settled === "bigint", typeof settled === "symbol", typeof settled === "function", typeof settled === "object", settled === null);
      console.log("Request.prototype.text, settled, the text:", settled.length === 0, settled === "");
    }
  } catch (error) {
    console.log("Request.prototype.text: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.textStream();
    console.log("Request.prototype.textStream, is it an operand:", result === subject);
    const again = subject.textStream();
    console.log("Request.prototype.textStream, does a second call answer the same thing:", result === again);
    console.log("Request.prototype.textStream:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.textStream, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Request.prototype.textStream, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Request.prototype.textStream, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Request.prototype.textStream, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Request.prototype.textStream, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Request.prototype.textStream: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject.url;
    console.log("Request.prototype.url, get, is it an operand:", result === subject);
    console.log("Request.prototype.url, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype.url, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype.url, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
    const result = subject[Symbol.toStringTag];
    console.log("Request.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Request.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Request.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Request.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
