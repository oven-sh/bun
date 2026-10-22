// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const subject = new EventTarget();
    const result = subject.addEventListener("an", null, 3.5);
    console.log("EventTarget.prototype.addEventListener, is it an operand:", result === subject);
    console.log("EventTarget.prototype.addEventListener:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("EventTarget.prototype.addEventListener: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = new EventTarget();
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.addEventListener("an", second, 3.5);
    console.log("EventTarget.prototype.addEventListener, form 2, is it an operand:", result === subject, result === second);
    console.log("EventTarget.prototype.addEventListener, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("EventTarget.prototype.addEventListener, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = new EventTarget();
    const result = subject.addEventListener("an", null, item);
    console.log("EventTarget.prototype.addEventListener, form 3, is it an operand:", result === subject, result === item);
    console.log("EventTarget.prototype.addEventListener, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("EventTarget.prototype.addEventListener, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventTarget();
    const result = subject.removeEventListener(1.5, null, 3.5);
    console.log("EventTarget.prototype.removeEventListener, is it an operand:", result === subject);
    console.log("EventTarget.prototype.removeEventListener:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("EventTarget.prototype.removeEventListener: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventTarget();
    const result = subject.removeEventListener("an", null, 3.5);
    console.log("EventTarget.prototype.removeEventListener, form 2, is it an operand:", result === subject);
    console.log("EventTarget.prototype.removeEventListener, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("EventTarget.prototype.removeEventListener, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const subject = new EventTarget();
    const result = subject.removeEventListener(item, null, item);
    console.log("EventTarget.prototype.removeEventListener, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("EventTarget.prototype.removeEventListener, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("EventTarget.prototype.removeEventListener, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new EventTarget();
    const result = subject[Symbol.toStringTag];
    console.log("EventTarget.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("EventTarget.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("EventTarget.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("EventTarget.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
