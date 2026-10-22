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
    const result = subject.addListener(1.5, callback);
    console.log("%EventEmitter%.prototype.addListener, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener.call(subject, 1.5, callback);
    console.log("%EventEmitter%.prototype.addListener, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener.apply(subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.addListener, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.addListener, subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener.bind(subject)(1.5, callback);
    console.log("%EventEmitter%.prototype.addListener, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener("an", callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, form 6._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, form 6._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.addListener, form 6._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.addListener, form 6._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, form 6._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, form 6._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, form 6, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.addListener, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.addListener.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.addListener, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.eventNames();
    console.log("%EventEmitter%.prototype.eventNames, is it an operand:", result === subject);
    const again = subject.eventNames();
    console.log("%EventEmitter%.prototype.eventNames, does a second call answer the same thing:", result === again);
    console.log("%EventEmitter%.prototype.eventNames:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.eventNames, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.eventNames, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.eventNames, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.eventNames, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.eventNames, how many keys:", Object.keys(result).length);
    console.log("%EventEmitter%.prototype.eventNames, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%EventEmitter%.prototype.eventNames, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.eventNames, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%EventEmitter%.prototype.eventNames, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%EventEmitter%.prototype.eventNames: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.getMaxListeners();
    console.log("%EventEmitter%.prototype.getMaxListeners, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.getMaxListeners:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.getMaxListeners, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%EventEmitter%.prototype.getMaxListeners: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.listenerCount("an");
    console.log("%EventEmitter%.prototype.listenerCount, is it an operand:", result === subject);
    console.log("%EventEmitter%.prototype.listenerCount:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.listenerCount, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%EventEmitter%.prototype.listenerCount: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    const result = subject.listeners("an");
    console.log("%EventEmitter%.prototype.listeners, is it an operand:", result === subject);
    const again = subject.listeners("an");
    console.log("%EventEmitter%.prototype.listeners, does a second call answer the same thing:", result === again);
    console.log("%EventEmitter%.prototype.listeners:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.listeners, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.listeners, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.listeners, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.listeners, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.listeners, how many keys:", Object.keys(result).length);
    console.log("%EventEmitter%.prototype.listeners, by index:", typeof result[0] === "undefined", typeof result[0] === "boolean", typeof result[0] === "number", typeof result[0] === "string", typeof result[0] === "bigint", typeof result[0] === "symbol", typeof result[0] === "function", typeof result[0] === "object", result[0] === null);
    console.log("%EventEmitter%.prototype.listeners, its length:", result.length === 0, result.length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.listeners, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%EventEmitter%.prototype.listeners, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%EventEmitter%.prototype.listeners: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.off("an", callback);
    console.log("%EventEmitter%.prototype.off, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.off:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.off, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.off, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.off, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.off, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.off, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.off._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.off._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.off._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.off._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.off._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.off._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.off._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.off._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.off._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.off: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.off.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.off, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.off, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.off, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.off, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.off, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.off, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.off, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.off, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.off, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.off, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.off, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.off, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.off, by call._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.off, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.off, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.off, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.off, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.off.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.off, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.off, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.off, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.off, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.off, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.off, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.off, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.off, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.off, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.off, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.off, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.off, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.off, by apply._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.off, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.off, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.off, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.off, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.off, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.off, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.off, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.off, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.off, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.off.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.off, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.off, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.off, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.off, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.off, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.off, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.off, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.off, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.off, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.off, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.off, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.off, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.off, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.off, by a bound function._events, how many keys:", Object.keys(result._events).length);
    console.log("%EventEmitter%.prototype.off, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.off, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.off, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.off, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on(1.5, callback);
    console.log("%EventEmitter%.prototype.on, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on.call(subject, 1.5, callback);
    console.log("%EventEmitter%.prototype.on, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on.apply(subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.on, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.on, subject, [1.5, callback]);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on.bind(subject)(1.5, callback);
    console.log("%EventEmitter%.prototype.on, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on("an", callback);
    console.log("%EventEmitter%.prototype.on, form 6, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, form 6, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, form 6, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, form 6, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, form 6, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, form 6, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, form 6._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, form 6._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, form 6._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, form 6._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, form 6._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.on, form 6._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.on, form 6._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.on, form 6._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, form 6._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, form 6._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on.call(subject, "an", callback);
    console.log("%EventEmitter%.prototype.on, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, form 6, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, form 6, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, form 6, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by call._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by call._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by call._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, form 6, by call._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by call._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by call._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by call._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by call._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by call._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by call._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.on, form 6, by call._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, form 6, by call._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, form 6, by call._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on.apply(subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.on, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, form 6, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, form 6, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, form 6, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, form 6, by apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.on, subject, ["an", callback]);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.on.bind(subject)("an", callback);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events.an:", typeof result._events.an === "undefined", typeof result._events.an === "boolean", typeof result._events.an === "number", typeof result._events.an === "string", typeof result._events.an === "bigint", typeof result._events.an === "symbol", typeof result._events.an === "function", typeof result._events.an === "object", result._events.an === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events.an, the class:", Array.isArray(result._events.an), result._events.an instanceof Object, result._events.an instanceof Array, result._events.an instanceof Map, result._events.an instanceof Set, result._events.an instanceof Promise, result._events.an instanceof Date, result._events.an instanceof RegExp, result._events.an instanceof Error, result._events.an instanceof ArrayBuffer, result._events.an instanceof Uint8Array, result._events.an instanceof Function, ArrayBuffer.isView(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events.an, above it:", Object.getPrototypeOf(result._events.an) === Object.prototype, Object.getPrototypeOf(result._events.an) === Array.prototype, Object.getPrototypeOf(result._events.an) === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events.an, its state:", Object.isFrozen(result._events.an), Object.isSealed(result._events.an), Object.isExtensible(result._events.an));
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._events.an, names in it:", "length" in result._events.an, "size" in result._events.an, "then" in result._events.an, "next" in result._events.an, "constructor" in result._events.an, Symbol.iterator in result._events.an);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.on, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventEmitter();
    function callback() {
      return true;
    }
    const result = subject.once(1.5, callback);
    console.log("%EventEmitter%.prototype.once, is it an operand:", result === subject, result === callback);
    console.log("%EventEmitter%.prototype.once:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%EventEmitter%.prototype.once, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%EventEmitter%.prototype.once, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%EventEmitter%.prototype.once, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%EventEmitter%.prototype.once, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%EventEmitter%.prototype.once, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once._events:", typeof result._events === "undefined", typeof result._events === "boolean", typeof result._events === "number", typeof result._events === "string", typeof result._events === "bigint", typeof result._events === "symbol", typeof result._events === "function", typeof result._events === "object", result._events === null);
    console.log("%EventEmitter%.prototype.once._events, the class:", Array.isArray(result._events), result._events instanceof Object, result._events instanceof Array, result._events instanceof Map, result._events instanceof Set, result._events instanceof Promise, result._events instanceof Date, result._events instanceof RegExp, result._events instanceof Error, result._events instanceof ArrayBuffer, result._events instanceof Uint8Array, result._events instanceof Function, ArrayBuffer.isView(result._events));
    console.log("%EventEmitter%.prototype.once._events, above it:", Object.getPrototypeOf(result._events) === Object.prototype, Object.getPrototypeOf(result._events) === Array.prototype, Object.getPrototypeOf(result._events) === null);
    console.log("%EventEmitter%.prototype.once._events, its state:", Object.isFrozen(result._events), Object.isSealed(result._events), Object.isExtensible(result._events));
    console.log("%EventEmitter%.prototype.once._events, names in it:", "length" in result._events, "size" in result._events, "then" in result._events, "next" in result._events, "constructor" in result._events, Symbol.iterator in result._events);
    console.log("%EventEmitter%.prototype.once._events, how many keys:", Object.keys(result._events).length);
    {
      let asked = 0;
      for (const value of Object.values(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once._events, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result._events)) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once._events, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result._events) {
        if (asked++ === 4) break;
        console.log("%EventEmitter%.prototype.once._events, by for-in:", typeof key === "string", typeof result._events[key] === "undefined", typeof result._events[key] === "boolean", typeof result._events[key] === "number", typeof result._events[key] === "string", typeof result._events[key] === "bigint", typeof result._events[key] === "symbol", typeof result._events[key] === "function", typeof result._events[key] === "object", result._events[key] === null);
      }
    }
    console.log("%EventEmitter%.prototype.once._eventsCount:", typeof result._eventsCount === "undefined", typeof result._eventsCount === "boolean", typeof result._eventsCount === "number", typeof result._eventsCount === "string", typeof result._eventsCount === "bigint", typeof result._eventsCount === "symbol", typeof result._eventsCount === "function", typeof result._eventsCount === "object", result._eventsCount === null);
    console.log("%EventEmitter%.prototype.once._eventsCount, the number:", Number.isInteger(result._eventsCount), result._eventsCount === result._eventsCount, result._eventsCount < 0, result._eventsCount > 2147483647, result._eventsCount < -2147483648, Object.is(result._eventsCount, -0), (result._eventsCount | 0) === result._eventsCount);
    console.log("%EventEmitter%.prototype.once._maxListeners:", typeof result._maxListeners === "undefined", typeof result._maxListeners === "boolean", typeof result._maxListeners === "number", typeof result._maxListeners === "string", typeof result._maxListeners === "bigint", typeof result._maxListeners === "symbol", typeof result._maxListeners === "function", typeof result._maxListeners === "object", result._maxListeners === null);
  } catch (error) {
    console.log("%EventEmitter%.prototype.once: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
