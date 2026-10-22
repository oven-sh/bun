// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = (1.5).toLocaleString("an", 2.5);
    console.log("Number.prototype.toLocaleString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Number.prototype.toLocaleString, form 3: it threw", error instanceof Error);
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
    const result = (1.5).toLocaleString(item, item);
    console.log("Number.prototype.toLocaleString, form 4, is it an operand:", result === item, result === item);
    console.log("Number.prototype.toLocaleString, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Number.prototype.toLocaleString, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).toPrecision(1);
    console.log("Number.prototype.toPrecision:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.prototype.toPrecision, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Number.prototype.toPrecision: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).toString(16);
    console.log("Number.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Number.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).valueOf();
    console.log("Number.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.prototype.valueOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.prototype.valueOf: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
