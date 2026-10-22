// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const first = new Error("message");
    const second = new Error("message");
    const result = Error.appendStackTrace(first, second);
    console.log("Error.appendStackTrace, is it an operand:", result === first, result === second);
    console.log("Error.appendStackTrace:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Error.appendStackTrace: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new Error("message");
    const second = new Error("message");
    const result = Error.appendStackTrace(first, second);
    console.log("Error.appendStackTrace, form 2, is it an operand:", result === first, result === second);
    console.log("Error.appendStackTrace, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Error.appendStackTrace, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Error.captureStackTrace(first, 2.5);
    console.log("Error.captureStackTrace, is it an operand:", result === first);
    console.log("Error.captureStackTrace:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Error.captureStackTrace: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Error.captureStackTrace(first, 2.5);
    console.log("Error.captureStackTrace, form 2, is it an operand:", result === first);
    console.log("Error.captureStackTrace, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Error.captureStackTrace, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Error.captureStackTrace(first, item);
    console.log("Error.captureStackTrace, form 3, is it an operand:", result === first, result === item);
    console.log("Error.captureStackTrace, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Error.captureStackTrace, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Error.captureStackTrace(first, 2.5);
    console.log("Error.captureStackTrace, form 4, is it an operand:", result === first);
    console.log("Error.captureStackTrace, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Error.captureStackTrace, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error.isError(1.5);
    console.log("Error.isError:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.isError, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Error.isError: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error.isError("an");
    console.log("Error.isError, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.isError, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Error.isError, form 2: it threw", error instanceof Error);
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
    const result = Error.isError(item);
    console.log("Error.isError, form 3, is it an operand:", result === item);
    console.log("Error.isError, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.isError, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Error.isError, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error.isError(1.5);
    console.log("Error.isError, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.isError, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Error.isError, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error.length;
    console.log("Error.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Error.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Error.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error.name;
    console.log("Error.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Error.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Error.stackTraceLimit;
    console.log("Error.stackTraceLimit, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.stackTraceLimit, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Error.stackTraceLimit, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Error("message");
    const result = subject.name;
    console.log("Error.prototype.name, get, is it an operand:", result === subject);
    console.log("Error.prototype.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.prototype.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Error.prototype.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Error("message");
    const result = subject.toString();
    console.log("Error.prototype.toString, is it an operand:", result === subject);
    console.log("Error.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Error.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Error.prototype.toString: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
