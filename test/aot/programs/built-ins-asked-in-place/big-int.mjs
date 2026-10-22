// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = BigInt.asIntN(8, 257n);
    console.log("BigInt.asIntN:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.asIntN: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = BigInt.asIntN(8, 257n);
    console.log("BigInt.asIntN, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.asIntN, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = BigInt.asUintN(8, 257n);
    console.log("BigInt.asUintN:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.asUintN: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = BigInt.asUintN(8, 257n);
    console.log("BigInt.asUintN, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.asUintN, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = BigInt.length;
    console.log("BigInt.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("BigInt.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("BigInt.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("BigInt.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = BigInt.name;
    console.log("BigInt.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("BigInt.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("BigInt.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (5n).toLocaleString("ar");
    console.log("BigInt.prototype.toLocaleString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.prototype.toLocaleString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (5n).toLocaleString(1.5, 2.5);
    console.log("BigInt.prototype.toLocaleString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.prototype.toLocaleString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (5n).toLocaleString("an", 2.5);
    console.log("BigInt.prototype.toLocaleString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.prototype.toLocaleString, form 3: it threw", error instanceof Error);
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
    const result = (5n).toLocaleString(item, item);
    console.log("BigInt.prototype.toLocaleString, form 4, is it an operand:", result === item, result === item);
    console.log("BigInt.prototype.toLocaleString, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.prototype.toLocaleString, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (5n).toString(2);
    console.log("BigInt.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("BigInt.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("BigInt.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (5n).valueOf();
    console.log("BigInt.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("BigInt.prototype.valueOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (5n)[Symbol.toStringTag];
    console.log("BigInt.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("BigInt.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("BigInt.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
