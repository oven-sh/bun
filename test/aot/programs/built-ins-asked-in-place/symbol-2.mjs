// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject[Symbol.toPrimitive].apply(subject, []);
    console.log("Symbol.prototype[Symbol.toPrimitive], by apply, is it an operand:", result === subject);
    console.log("Symbol.prototype[Symbol.toPrimitive], by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype[Symbol.toPrimitive], by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = Reflect.apply(subject[Symbol.toPrimitive], subject, []);
    console.log("Symbol.prototype[Symbol.toPrimitive], by Reflect.apply, is it an operand:", result === subject);
    console.log("Symbol.prototype[Symbol.toPrimitive], by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype[Symbol.toPrimitive], by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject[Symbol.toPrimitive].bind(subject)();
    console.log("Symbol.prototype[Symbol.toPrimitive], by a bound function, is it an operand:", result === subject);
    console.log("Symbol.prototype[Symbol.toPrimitive], by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype[Symbol.toPrimitive], by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject[Symbol.toStringTag];
    console.log("Symbol.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("Symbol.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Symbol.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
