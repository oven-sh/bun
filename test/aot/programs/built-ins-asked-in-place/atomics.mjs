// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.add(first, 2, 3);
    console.log("Atomics.add, is it an operand:", result === first);
    console.log("Atomics.add, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.add:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.add, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.add: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.add(first, 2, 3);
    console.log("Atomics.add, form 2, is it an operand:", result === first);
    console.log("Atomics.add, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.add, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.add, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.add, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.add(first, 2, 5n);
    console.log("Atomics.add, form 3, is it an operand:", result === first);
    console.log("Atomics.add, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.add, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.and(first, 2, 3);
    console.log("Atomics.and, is it an operand:", result === first);
    console.log("Atomics.and, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.and:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.and, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.and: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.and(first, 2, 3);
    console.log("Atomics.and, form 2, is it an operand:", result === first);
    console.log("Atomics.and, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.and, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.and, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.and, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.and(first, 2, 5n);
    console.log("Atomics.and, form 3, is it an operand:", result === first);
    console.log("Atomics.and, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.and, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.compareExchange(first, 2, 3, 4);
    console.log("Atomics.compareExchange, is it an operand:", result === first);
    console.log("Atomics.compareExchange, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.compareExchange:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.compareExchange, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.compareExchange: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.compareExchange(first, 2, 3, 4);
    console.log("Atomics.compareExchange, form 2, is it an operand:", result === first);
    console.log("Atomics.compareExchange, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.compareExchange, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.compareExchange, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.compareExchange, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.compareExchange(first, 2, 5n, 5n);
    console.log("Atomics.compareExchange, form 3, is it an operand:", result === first);
    console.log("Atomics.compareExchange, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.compareExchange, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.exchange(first, 2, 3);
    console.log("Atomics.exchange, is it an operand:", result === first);
    console.log("Atomics.exchange, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.exchange:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.exchange, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.exchange: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.exchange(first, 2, 3);
    console.log("Atomics.exchange, form 2, is it an operand:", result === first);
    console.log("Atomics.exchange, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.exchange, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.exchange, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.exchange, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.exchange(first, 2, 5n);
    console.log("Atomics.exchange, form 3, is it an operand:", result === first);
    console.log("Atomics.exchange, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.exchange, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Atomics.isLockFree(1);
    console.log("Atomics.isLockFree:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.isLockFree, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Atomics.isLockFree: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Atomics.isLockFree(1);
    console.log("Atomics.isLockFree, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.isLockFree, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Atomics.isLockFree, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.load(first, 2);
    console.log("Atomics.load, is it an operand:", result === first);
    console.log("Atomics.load, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.load:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.load, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.load: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.load(first, 2);
    console.log("Atomics.load, form 2, is it an operand:", result === first);
    console.log("Atomics.load, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.load, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.load, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.load, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.load(first, 2);
    console.log("Atomics.load, form 3, is it an operand:", result === first);
    console.log("Atomics.load, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.load, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.or(first, 2, 3);
    console.log("Atomics.or, is it an operand:", result === first);
    console.log("Atomics.or, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.or:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.or, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.or: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.or(first, 2, 3);
    console.log("Atomics.or, form 2, is it an operand:", result === first);
    console.log("Atomics.or, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.or, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.or, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.or, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.or(first, 2, 5n);
    console.log("Atomics.or, form 3, is it an operand:", result === first);
    console.log("Atomics.or, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.or, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.store(first, 2, 3);
    console.log("Atomics.store, is it an operand:", result === first);
    console.log("Atomics.store:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.store, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.store: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.store(first, 2, 3);
    console.log("Atomics.store, form 2, is it an operand:", result === first);
    console.log("Atomics.store, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.store, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.store, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.store(first, 2, 5n);
    console.log("Atomics.store, form 3, is it an operand:", result === first);
    console.log("Atomics.store, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.store, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.sub(first, 2, 3);
    console.log("Atomics.sub, is it an operand:", result === first);
    console.log("Atomics.sub, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.sub:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.sub, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.sub: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.sub(first, 2, 3);
    console.log("Atomics.sub, form 2, is it an operand:", result === first);
    console.log("Atomics.sub, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.sub, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.sub, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.sub, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.sub(first, 2, 5n);
    console.log("Atomics.sub, form 3, is it an operand:", result === first);
    console.log("Atomics.sub, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.sub, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.xor(first, 2, 3);
    console.log("Atomics.xor, is it an operand:", result === first);
    console.log("Atomics.xor, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.xor:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.xor, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.xor: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Int16Array([1, 2, 3]);
    const result = Atomics.xor(first, 2, 3);
    console.log("Atomics.xor, form 2, is it an operand:", result === first);
    console.log("Atomics.xor, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 4294967295));
    console.log("Atomics.xor, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics.xor, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Atomics.xor, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new BigInt64Array([1n, 2n, 3n]);
    const result = Atomics.xor(first, 2, 5n);
    console.log("Atomics.xor, form 3, is it an operand:", result === first);
    console.log("Atomics.xor, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Atomics.xor, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Atomics[Symbol.toStringTag];
    console.log("Atomics[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Atomics[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Atomics[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
