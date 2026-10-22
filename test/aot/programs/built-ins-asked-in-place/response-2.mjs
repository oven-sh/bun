// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.type;
    console.log("Response.prototype.type, get, is it an operand:", result === subject);
    console.log("Response.prototype.type, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.type, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Response.prototype.type, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject.url;
    console.log("Response.prototype.url, get, is it an operand:", result === subject);
    console.log("Response.prototype.url, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype.url, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Response.prototype.url, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
    const result = subject[Symbol.toStringTag];
    console.log("Response.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Response.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Response.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Response.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
