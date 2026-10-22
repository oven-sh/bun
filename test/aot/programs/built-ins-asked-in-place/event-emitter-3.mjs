// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
import { EventEmitter } from "node:events";
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.removeAllListeners("an");
    console.log("%EventEmitter%.prototype.removeAllListeners, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.removeAllListeners:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeAllListeners, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeAllListeners._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeAllListeners._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeAllListeners._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeAllListeners._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeAllListeners._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeAllListeners._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeAllListeners: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.removeAllListeners.call(subject, "an");
    console.log("%EventEmitter%.prototype.removeAllListeners, by call, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeAllListeners, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeAllListeners, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.removeAllListeners.apply(subject, ["an"]);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeAllListeners, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = Reflect.apply(subject.removeAllListeners, subject, ["an"]);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeAllListeners, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.removeAllListeners.bind(subject)("an");
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeAllListeners, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.removeListener("an", callback);
    console.log("%EventEmitter%.prototype.removeListener, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.removeListener:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeListener, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeListener, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeListener, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeListener, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeListener, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeListener._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeListener._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeListener._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeListener._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeListener._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeListener._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeListener._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeListener._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeListener._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeListener: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.removeListener.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.removeListener, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.removeListener, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeListener, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeListener, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeListener, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeListener, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeListener, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeListener, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeListener, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeListener, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeListener, by call._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeListener, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeListener, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeListener, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeListener, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.removeListener.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.removeListener, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.removeListener, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeListener, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeListener, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeListener, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeListener, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeListener, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeListener, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeListener, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeListener, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeListener, by apply._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeListener, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeListener, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeListener, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeListener, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.removeListener, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeListener, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.removeListener.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.removeListener, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.removeListener, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.removeListener, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.removeListener, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.removeListener, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.setMaxListeners(1.5);
    console.log("%EventEmitter%.prototype.setMaxListeners, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.setMaxListeners:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.setMaxListeners, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.setMaxListeners, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.setMaxListeners, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.setMaxListeners, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.setMaxListeners, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.setMaxListeners, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.setMaxListeners, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.setMaxListeners, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.setMaxListeners._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.setMaxListeners._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.setMaxListeners._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.setMaxListeners._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.setMaxListeners._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.setMaxListeners._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.setMaxListeners._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.setMaxListeners._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.setMaxListeners._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
    console.log("%EventEmitter%.prototype.setMaxListeners._maxListeners, the number:", Number.isInteger(result._maxListeners), result._maxListeners === result._maxListeners, result._maxListeners < 0, result._maxListeners > 2147483647, result._maxListeners < -2147483648, Object.is(result._maxListeners, -0), (result._maxListeners | 0) === result._maxListeners);
  } catch (error) {
    console.log("%EventEmitter%.prototype.setMaxListeners: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
