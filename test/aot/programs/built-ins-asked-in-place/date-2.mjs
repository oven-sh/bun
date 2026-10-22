// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setMilliseconds(1.5);
    console.log("Date.prototype.setMilliseconds, is it an operand:", result === date);
    console.log("Date.prototype.setMilliseconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setMilliseconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setMilliseconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setMinutes(1.5, 2.5, 3.5);
    console.log("Date.prototype.setMinutes, is it an operand:", result === date);
    console.log("Date.prototype.setMinutes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setMinutes, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setMinutes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setMonth(1.5, 2.5);
    console.log("Date.prototype.setMonth, is it an operand:", result === date);
    console.log("Date.prototype.setMonth:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setMonth, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setMonth: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setSeconds(1.5, 2.5);
    console.log("Date.prototype.setSeconds, is it an operand:", result === date);
    console.log("Date.prototype.setSeconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setSeconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setSeconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setTime(1.5);
    console.log("Date.prototype.setTime, is it an operand:", result === date);
    console.log("Date.prototype.setTime:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setTime, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setTime: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCDate(1.5);
    console.log("Date.prototype.setUTCDate, is it an operand:", result === date);
    console.log("Date.prototype.setUTCDate:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCDate, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCDate: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCFullYear(1.5, 2.5, 3.5);
    console.log("Date.prototype.setUTCFullYear, is it an operand:", result === date);
    console.log("Date.prototype.setUTCFullYear:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCFullYear, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCFullYear: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCHours(1.5, 2.5, 3.5, 4.5);
    console.log("Date.prototype.setUTCHours, is it an operand:", result === date);
    console.log("Date.prototype.setUTCHours:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCHours, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCHours: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCMilliseconds(1.5);
    console.log("Date.prototype.setUTCMilliseconds, is it an operand:", result === date);
    console.log("Date.prototype.setUTCMilliseconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCMilliseconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCMilliseconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCMinutes(1.5, 2.5, 3.5);
    console.log("Date.prototype.setUTCMinutes, is it an operand:", result === date);
    console.log("Date.prototype.setUTCMinutes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCMinutes, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCMinutes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCMonth(1.5, 2.5);
    console.log("Date.prototype.setUTCMonth, is it an operand:", result === date);
    console.log("Date.prototype.setUTCMonth:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCMonth, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCMonth: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setUTCSeconds(1.5, 2.5);
    console.log("Date.prototype.setUTCSeconds, is it an operand:", result === date);
    console.log("Date.prototype.setUTCSeconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setUTCSeconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setUTCSeconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setYear(1.5);
    console.log("Date.prototype.setYear, is it an operand:", result === date);
    console.log("Date.prototype.setYear:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setYear, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setYear: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toDateString();
    console.log("Date.prototype.toDateString, is it an operand:", result === date);
    console.log("Date.prototype.toDateString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toDateString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toISOString();
    console.log("Date.prototype.toISOString, is it an operand:", result === date);
    console.log("Date.prototype.toISOString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.toISOString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Date.prototype.toISOString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toJSON(1.5);
    console.log("Date.prototype.toJSON, is it an operand:", result === date);
    console.log("Date.prototype.toJSON:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.toJSON, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Date.prototype.toJSON: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toJSON("an");
    console.log("Date.prototype.toJSON, form 2, is it an operand:", result === date);
    console.log("Date.prototype.toJSON, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.toJSON, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Date.prototype.toJSON, form 2: it threw", error instanceof Error);
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
    const date = new Date(86400000.5);
    const result = date.toJSON(item);
    console.log("Date.prototype.toJSON, form 3, is it an operand:", result === date, result === item);
    console.log("Date.prototype.toJSON, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.toJSON, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Date.prototype.toJSON, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleDateString("ar");
    console.log("Date.prototype.toLocaleDateString, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleDateString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleDateString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleDateString(1.5, 2.5);
    console.log("Date.prototype.toLocaleDateString, form 2, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleDateString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleDateString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleDateString("an", 2.5);
    console.log("Date.prototype.toLocaleDateString, form 3, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleDateString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleDateString, form 3: it threw", error instanceof Error);
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
    const date = new Date(86400000.5);
    const result = date.toLocaleDateString(item, item);
    console.log("Date.prototype.toLocaleDateString, form 4, is it an operand:", result === date, result === item, result === item);
    console.log("Date.prototype.toLocaleDateString, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleDateString, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleString("ar");
    console.log("Date.prototype.toLocaleString, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleString(1.5, 2.5);
    console.log("Date.prototype.toLocaleString, form 2, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleString("an", 2.5);
    console.log("Date.prototype.toLocaleString, form 3, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleString, form 3: it threw", error instanceof Error);
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
    const date = new Date(86400000.5);
    const result = date.toLocaleString(item, item);
    console.log("Date.prototype.toLocaleString, form 4, is it an operand:", result === date, result === item, result === item);
    console.log("Date.prototype.toLocaleString, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleString, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleTimeString("ar");
    console.log("Date.prototype.toLocaleTimeString, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleTimeString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleTimeString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleTimeString(1.5, 2.5);
    console.log("Date.prototype.toLocaleTimeString, form 2, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleTimeString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleTimeString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.toLocaleTimeString("an", 2.5);
    console.log("Date.prototype.toLocaleTimeString, form 3, is it an operand:", result === date);
    console.log("Date.prototype.toLocaleTimeString, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleTimeString, form 3: it threw", error instanceof Error);
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
    const date = new Date(86400000.5);
    const result = date.toLocaleTimeString(item, item);
    console.log("Date.prototype.toLocaleTimeString, form 4, is it an operand:", result === date, result === item, result === item);
    console.log("Date.prototype.toLocaleTimeString, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.toLocaleTimeString, form 4: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
