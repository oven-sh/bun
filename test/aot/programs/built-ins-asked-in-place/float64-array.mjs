// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Float64Array.BYTES_PER_ELEMENT;
    console.log("Float64Array.BYTES_PER_ELEMENT, get, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 8));
    console.log("Float64Array.BYTES_PER_ELEMENT, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float64Array.BYTES_PER_ELEMENT, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Float64Array.BYTES_PER_ELEMENT, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Float64Array.length;
    console.log("Float64Array.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Float64Array.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float64Array.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Float64Array.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Float64Array.name;
    console.log("Float64Array.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float64Array.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Float64Array.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Float64Array([1, 2, 3]);
    const result = subject.BYTES_PER_ELEMENT;
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, is it an operand:", result === subject);
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 8));
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Float64Array(0);
    const result = subject.BYTES_PER_ELEMENT;
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, form 2, is it an operand:", result === subject);
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 8 && result <= 8));
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Float64Array.prototype.BYTES_PER_ELEMENT, get, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
