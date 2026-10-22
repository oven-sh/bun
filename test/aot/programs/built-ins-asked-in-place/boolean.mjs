// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Boolean.length;
    console.log("Boolean.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Boolean.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Boolean.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Boolean.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Boolean.name;
    console.log("Boolean.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Boolean.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Boolean.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = true.toString();
    console.log("Boolean.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Boolean.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Boolean.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = true.valueOf();
    console.log("Boolean.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Boolean.prototype.valueOf, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Boolean.prototype.valueOf: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
