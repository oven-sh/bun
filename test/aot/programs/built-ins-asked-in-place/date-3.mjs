// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toString();
    console.log("Date.prototype.toString, is it an operand:", result === date);
    console.log("Date.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toTemporalInstant();
    console.log("Date.prototype.toTemporalInstant, is it an operand:", result === date);
    const again = date.toTemporalInstant();
    console.log("Date.prototype.toTemporalInstant, does a second call answer the same thing:", result === again);
    console.log("Date.prototype.toTemporalInstant:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.toTemporalInstant, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Date.prototype.toTemporalInstant, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Date.prototype.toTemporalInstant, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Date.prototype.toTemporalInstant, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Date.prototype.toTemporalInstant, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Date.prototype.toTemporalInstant: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toTimeString();
    console.log("Date.prototype.toTimeString, is it an operand:", result === date);
    console.log("Date.prototype.toTimeString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toTimeString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toUTCString();
    console.log("Date.prototype.toUTCString, is it an operand:", result === date);
    console.log("Date.prototype.toUTCString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.toUTCString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Date.prototype.toUTCString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.valueOf();
    console.log("Date.prototype.valueOf, is it an operand:", result === date);
    console.log("Date.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.valueOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.valueOf: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
