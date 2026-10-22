// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Math.pow(1.5, 2.5);
    console.log("Math.pow:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.pow, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.pow: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.pow(1.5, 2.5);
    console.log("Math.pow, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.pow, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.pow, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.random();
    console.log("Math.random:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Math.random: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.random();
    console.log("Math.random, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Math.random, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.round(1.5);
    console.log("Math.round:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.round, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.round: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.round(1.5);
    console.log("Math.round, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.round, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.round, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sign(1.5);
    console.log("Math.sign:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sign, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sign: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sign(1.5);
    console.log("Math.sign, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sign, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sign, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sin(1.5);
    console.log("Math.sin:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sin, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sin: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sin(1.5);
    console.log("Math.sin, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sin, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sin, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sinh(1.5);
    console.log("Math.sinh:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sinh, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sinh: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sinh(1.5);
    console.log("Math.sinh, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sinh, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sinh, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sqrt(1.5);
    console.log("Math.sqrt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sqrt, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sqrt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.sqrt(1.5);
    console.log("Math.sqrt, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sqrt, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sqrt, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = [1.5, 2.5];
    const result = Math.sumPrecise(first);
    console.log("Math.sumPrecise, is it an operand:", result === first);
    console.log("Math.sumPrecise:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sumPrecise, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sumPrecise: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = [1.5, 2.5];
    const result = Math.sumPrecise(first);
    console.log("Math.sumPrecise, form 2, is it an operand:", result === first);
    console.log("Math.sumPrecise, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.sumPrecise, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.sumPrecise, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.tan(1.5);
    console.log("Math.tan:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.tan, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.tan: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.tan(1.5);
    console.log("Math.tan, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.tan, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.tan, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.tanh(1.5);
    console.log("Math.tanh:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.tanh, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.tanh: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.tanh(1.5);
    console.log("Math.tanh, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.tanh, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.tanh, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.trunc(1.5);
    console.log("Math.trunc:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.trunc, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.trunc: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math.trunc(1.5);
    console.log("Math.trunc, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math.trunc, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Math.trunc, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Math[Symbol.toStringTag];
    console.log("Math[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Math[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Math[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
