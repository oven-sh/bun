// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Bun.Glob("*.js");
    const result = subject.match("banana");
    console.log("Bun.Glob.prototype.match, is it an operand:", result === subject);
    console.log("Bun.Glob.prototype.match:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.Glob.prototype.match, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.Glob.prototype.match: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Bun.Glob("*.js");
    const result = subject.match("");
    console.log("Bun.Glob.prototype.match, form 2, is it an operand:", result === subject);
    console.log("Bun.Glob.prototype.match, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.Glob.prototype.match, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Bun.Glob.prototype.match, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
