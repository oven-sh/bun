// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Date.UTC(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5);
    console.log("Date.UTC:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.UTC, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.UTC: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.UTC(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5);
    console.log("Date.UTC, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.UTC, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.UTC, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.length;
    console.log("Date.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Date.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.name;
    console.log("Date.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Date.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.now();
    console.log("Date.now:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.now: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.now();
    console.log("Date.now, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.now, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.parse("2026-01-02T03:04:05.678Z");
    console.log("Date.parse:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.parse, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.parse: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Date.parse("2026-01-02T03:04:05.678Z");
    console.log("Date.parse, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.parse, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.parse, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getDate();
    console.log("Date.prototype.getDate, is it an operand:", result === date);
    console.log("Date.prototype.getDate:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getDate, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getDate: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getDay();
    console.log("Date.prototype.getDay, is it an operand:", result === date);
    console.log("Date.prototype.getDay:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getDay, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getDay: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getFullYear();
    console.log("Date.prototype.getFullYear, is it an operand:", result === date);
    console.log("Date.prototype.getFullYear:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getFullYear, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getFullYear: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getHours();
    console.log("Date.prototype.getHours, is it an operand:", result === date);
    console.log("Date.prototype.getHours:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getHours, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getHours: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getMilliseconds();
    console.log("Date.prototype.getMilliseconds, is it an operand:", result === date);
    console.log("Date.prototype.getMilliseconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getMilliseconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getMilliseconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getMinutes();
    console.log("Date.prototype.getMinutes, is it an operand:", result === date);
    console.log("Date.prototype.getMinutes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getMinutes, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getMinutes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getMonth();
    console.log("Date.prototype.getMonth, is it an operand:", result === date);
    console.log("Date.prototype.getMonth:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getMonth, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getMonth: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getSeconds();
    console.log("Date.prototype.getSeconds, is it an operand:", result === date);
    console.log("Date.prototype.getSeconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getSeconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getSeconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getTime();
    console.log("Date.prototype.getTime, is it an operand:", result === date);
    console.log("Date.prototype.getTime:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getTime, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getTime: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getTimezoneOffset();
    console.log("Date.prototype.getTimezoneOffset, is it an operand:", result === date);
    console.log("Date.prototype.getTimezoneOffset:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Date.prototype.getTimezoneOffset: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCDate();
    console.log("Date.prototype.getUTCDate, is it an operand:", result === date);
    console.log("Date.prototype.getUTCDate:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCDate, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCDate: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCDay();
    console.log("Date.prototype.getUTCDay, is it an operand:", result === date);
    console.log("Date.prototype.getUTCDay:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCDay, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCDay: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCFullYear();
    console.log("Date.prototype.getUTCFullYear, is it an operand:", result === date);
    console.log("Date.prototype.getUTCFullYear:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCFullYear, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCFullYear: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCHours();
    console.log("Date.prototype.getUTCHours, is it an operand:", result === date);
    console.log("Date.prototype.getUTCHours:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCHours, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCHours: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCMilliseconds();
    console.log("Date.prototype.getUTCMilliseconds, is it an operand:", result === date);
    console.log("Date.prototype.getUTCMilliseconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCMilliseconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCMilliseconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCMinutes();
    console.log("Date.prototype.getUTCMinutes, is it an operand:", result === date);
    console.log("Date.prototype.getUTCMinutes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCMinutes, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCMinutes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCMonth();
    console.log("Date.prototype.getUTCMonth, is it an operand:", result === date);
    console.log("Date.prototype.getUTCMonth:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCMonth, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCMonth: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getUTCSeconds();
    console.log("Date.prototype.getUTCSeconds, is it an operand:", result === date);
    console.log("Date.prototype.getUTCSeconds:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getUTCSeconds, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getUTCSeconds: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.getYear();
    console.log("Date.prototype.getYear, is it an operand:", result === date);
    console.log("Date.prototype.getYear:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.getYear, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.getYear: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setDate(1.5);
    console.log("Date.prototype.setDate, is it an operand:", result === date);
    console.log("Date.prototype.setDate:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setDate, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setDate: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setFullYear(1.5, 2.5, 3.5);
    console.log("Date.prototype.setFullYear, is it an operand:", result === date);
    console.log("Date.prototype.setFullYear:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setFullYear, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setFullYear: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const date = new Date(86400000.5);
    const result = date.setHours(1.5, 2.5, 3.5, 4.5);
    console.log("Date.prototype.setHours, is it an operand:", result === date);
    console.log("Date.prototype.setHours:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Date.prototype.setHours, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Date.prototype.setHours: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
