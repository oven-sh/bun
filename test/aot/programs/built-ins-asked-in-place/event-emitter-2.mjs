// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
import { EventEmitter } from "node:events";
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once.call(subject, 1.5, callback);
    console.log("%EventEmitter%.prototype.once, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once.apply(subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.once, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.once, subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once.bind(subject)(1.5, callback);
    console.log("%EventEmitter%.prototype.once, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once("an", callback);
    console.log("%EventEmitter%.prototype.once, form 6, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, form 6._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, form 6._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, form 6._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, form 6._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, form 6._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.once, form 6._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.once, form 6._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.once, form 6._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, form 6._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, form 6._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.once, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, form 6, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by call._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by call._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by call._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.once, form 6, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, form 6, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, form 6, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.once, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, form 6, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.once, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener(1.5, callback);
    console.log("%EventEmitter%.prototype.prependListener, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener.call(subject, 1.5, callback);
    console.log("%EventEmitter%.prototype.prependListener, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener.apply(subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.prependListener, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.prependListener, subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener.bind(subject)(1.5, callback);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener("an", callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, form 6._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependListener, form 6._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, form 6._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.prependListener, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependListener.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependListener, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener(1.5, callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener.call(subject, 1.5, callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener.apply(subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.prependOnceListener, subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener.bind(subject)(1.5, callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener("an", callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.prependOnceListener, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.prependOnceListener.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.prependOnceListener, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.rawListeners("an");
    console.log("%EventEmitter%.prototype.rawListeners, is it an operand:", result === subject);
    const again = subject.rawListeners("an");
    console.log("%EventEmitter%.prototype.rawListeners, does a second call answer the same thing:", result === again);
    console.log("%EventEmitter%.prototype.rawListeners:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.rawListeners, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.rawListeners, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.rawListeners, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.rawListeners, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.rawListeners, how many keys:", Object.keys(result).length);
    console.log("%EventEmitter%.prototype.rawListeners, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%EventEmitter%.prototype.rawListeners, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.rawListeners, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%EventEmitter%.prototype.rawListeners, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%EventEmitter%.prototype.rawListeners: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
