// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.bubbles;
    console.log("Event.prototype.bubbles, get, is it an operand:", result === subject);
    console.log("Event.prototype.bubbles, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Event.prototype.bubbles, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Event.prototype.bubbles, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.cancelable;
    console.log("Event.prototype.cancelable, get, is it an operand:", result === subject);
    console.log("Event.prototype.cancelable, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Event.prototype.cancelable, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Event.prototype.cancelable, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.composed;
    console.log("Event.prototype.composed, get, is it an operand:", result === subject);
    console.log("Event.prototype.composed, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Event.prototype.composed, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Event.prototype.composed, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.defaultPrevented;
    console.log("Event.prototype.defaultPrevented, get, is it an operand:", result === subject);
    console.log("Event.prototype.defaultPrevented, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Event.prototype.defaultPrevented, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Event.prototype.defaultPrevented, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.eventPhase;
    console.log("Event.prototype.eventPhase, get, is it an operand:", result === subject);
    console.log("Event.prototype.eventPhase, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 65535));
    console.log("Event.prototype.eventPhase, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Event.prototype.eventPhase, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Event.prototype.eventPhase, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.preventDefault();
    console.log("Event.prototype.preventDefault, is it an operand:", result === subject);
    console.log("Event.prototype.preventDefault:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Event.prototype.preventDefault: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.stopImmediatePropagation();
    console.log("Event.prototype.stopImmediatePropagation, is it an operand:", result === subject);
    console.log("Event.prototype.stopImmediatePropagation:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Event.prototype.stopImmediatePropagation: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.stopPropagation();
    console.log("Event.prototype.stopPropagation, is it an operand:", result === subject);
    console.log("Event.prototype.stopPropagation:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Event.prototype.stopPropagation: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Event("ready");
    const result = subject.type;
    console.log("Event.prototype.type, get, is it an operand:", result === subject);
    console.log("Event.prototype.type, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Event.prototype.type, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Event.prototype.type, get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
