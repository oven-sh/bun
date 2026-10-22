// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = RangeError.length;
    console.log("RangeError.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("RangeError.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("RangeError.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = RangeError.name;
    console.log("RangeError.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("RangeError.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("RangeError.name, get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
