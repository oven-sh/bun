// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Number.EPSILON;
    console.log("Number.EPSILON, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.EPSILON, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.EPSILON, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.MAX_SAFE_INTEGER;
    console.log("Number.MAX_SAFE_INTEGER, get, does it lie where its row says:", typeof result !== "number" || (result >= 9007199254740991 && result <= 9007199254740991));
    console.log("Number.MAX_SAFE_INTEGER, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.MAX_SAFE_INTEGER, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.MAX_SAFE_INTEGER, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.MAX_VALUE;
    console.log("Number.MAX_VALUE, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.MAX_VALUE, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.MAX_VALUE, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.MIN_SAFE_INTEGER;
    console.log("Number.MIN_SAFE_INTEGER, get, does it lie where its row says:", typeof result !== "number" || (result >= -9007199254740991 && result <= -9007199254740991));
    console.log("Number.MIN_SAFE_INTEGER, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.MIN_SAFE_INTEGER, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.MIN_SAFE_INTEGER, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.MIN_VALUE;
    console.log("Number.MIN_VALUE, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.MIN_VALUE, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.MIN_VALUE, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.NEGATIVE_INFINITY;
    console.log("Number.NEGATIVE_INFINITY, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.NEGATIVE_INFINITY, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.NEGATIVE_INFINITY, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.NaN;
    console.log("Number.NaN, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.NaN, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.NaN, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.POSITIVE_INFINITY;
    console.log("Number.POSITIVE_INFINITY, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.POSITIVE_INFINITY, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.POSITIVE_INFINITY, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isFinite(1.5);
    console.log("Number.isFinite:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isFinite, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isFinite: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isFinite("an");
    console.log("Number.isFinite, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isFinite, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isFinite, form 2: it threw", error instanceof Error);
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
    const result = Number.isFinite(item);
    console.log("Number.isFinite, form 3, is it an operand:", result === item);
    console.log("Number.isFinite, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isFinite, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isFinite, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isFinite(1.5);
    console.log("Number.isFinite, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isFinite, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isFinite, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isInteger(1.5);
    console.log("Number.isInteger:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isInteger, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isInteger: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isInteger("an");
    console.log("Number.isInteger, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isInteger, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isInteger, form 2: it threw", error instanceof Error);
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
    const result = Number.isInteger(item);
    console.log("Number.isInteger, form 3, is it an operand:", result === item);
    console.log("Number.isInteger, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isInteger, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isInteger, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isInteger(1.5);
    console.log("Number.isInteger, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isInteger, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isInteger, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isNaN(1.5);
    console.log("Number.isNaN:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isNaN, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isNaN: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isNaN("an");
    console.log("Number.isNaN, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isNaN, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isNaN, form 2: it threw", error instanceof Error);
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
    const result = Number.isNaN(item);
    console.log("Number.isNaN, form 3, is it an operand:", result === item);
    console.log("Number.isNaN, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isNaN, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isNaN, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isNaN(1.5);
    console.log("Number.isNaN, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isNaN, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isNaN, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isSafeInteger(1.5);
    console.log("Number.isSafeInteger:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isSafeInteger, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isSafeInteger: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isSafeInteger("an");
    console.log("Number.isSafeInteger, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isSafeInteger, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isSafeInteger, form 2: it threw", error instanceof Error);
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
    const result = Number.isSafeInteger(item);
    console.log("Number.isSafeInteger, form 3, is it an operand:", result === item);
    console.log("Number.isSafeInteger, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isSafeInteger, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isSafeInteger, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.isSafeInteger(1.5);
    console.log("Number.isSafeInteger, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.isSafeInteger, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Number.isSafeInteger, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.length;
    console.log("Number.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Number.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Number.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Number.name;
    console.log("Number.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Number.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).toExponential(1);
    console.log("Number.prototype.toExponential:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.prototype.toExponential, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Number.prototype.toExponential: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).toFixed(1);
    console.log("Number.prototype.toFixed:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Number.prototype.toFixed, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Number.prototype.toFixed: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).toLocaleString("ar");
    console.log("Number.prototype.toLocaleString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Number.prototype.toLocaleString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = (1.5).toLocaleString(1.5, 2.5);
    console.log("Number.prototype.toLocaleString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Number.prototype.toLocaleString, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
