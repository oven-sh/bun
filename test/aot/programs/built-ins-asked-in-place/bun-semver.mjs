// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Bun.semver.order("1.0.0", "2.0.0");
    console.log("Bun.semver.order, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 2147483647));
    console.log("Bun.semver.order:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.semver.order, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.semver.order: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.semver.order("1.0.0", "2.0.0");
    console.log("Bun.semver.order, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -2147483648 && result <= 2147483647));
    console.log("Bun.semver.order, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.semver.order, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.semver.order, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.semver.satisfies("1.5.0", "^1.0.0");
    console.log("Bun.semver.satisfies:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.semver.satisfies, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.semver.satisfies: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Bun.semver.satisfies("1.5.0", "^1.0.0");
    console.log("Bun.semver.satisfies, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.semver.satisfies, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.semver.satisfies, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
