// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = "banana".fixed();
    console.log("String.prototype.fixed:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.fixed, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.fixed: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".fixed();
    console.log("String.prototype.fixed, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.fixed, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.fixed, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".fontcolor("an");
    console.log("String.prototype.fontcolor:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.fontcolor, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.fontcolor: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".fontcolor("an");
    console.log("String.prototype.fontcolor, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.fontcolor, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.fontcolor, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".fontsize("an");
    console.log("String.prototype.fontsize:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.fontsize, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.fontsize: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".fontsize("an");
    console.log("String.prototype.fontsize, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.fontsize, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.fontsize, form 2: it threw", error instanceof Error);
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
    const result = "banana".includes(first, 2.5);
    console.log("String.prototype.includes, is it an operand:", result === first);
    console.log("String.prototype.includes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.includes, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.includes: it threw", error instanceof Error);
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
    const result = "banana".includes(first, 2.5);
    console.log("String.prototype.includes, form 2, is it an operand:", result === first);
    console.log("String.prototype.includes, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.includes, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.includes, form 2: it threw", error instanceof Error);
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
    const result = "banana".includes(first, item);
    console.log("String.prototype.includes, form 3, is it an operand:", result === first, result === item);
    console.log("String.prototype.includes, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.includes, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.includes, form 3: it threw", error instanceof Error);
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
    const result = "".includes(first, 2.5);
    console.log("String.prototype.includes, form 4, is it an operand:", result === first);
    console.log("String.prototype.includes, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.includes, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.includes, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".includes("an", 2);
    console.log("String.prototype.includes, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.includes, form 5, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.includes, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".includes("an", 2);
    console.log("String.prototype.includes, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.includes, form 6, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.includes, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".indexOf("an", 2);
    console.log("String.prototype.indexOf, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 2147483647));
    console.log("String.prototype.indexOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.indexOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.indexOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".indexOf("an", 2);
    console.log("String.prototype.indexOf, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 2147483647));
    console.log("String.prototype.indexOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.indexOf, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.indexOf, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".isWellFormed();
    console.log("String.prototype.isWellFormed:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.isWellFormed, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.isWellFormed: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".isWellFormed();
    console.log("String.prototype.isWellFormed, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.isWellFormed, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.isWellFormed, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".italics();
    console.log("String.prototype.italics:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.italics, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.italics: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".italics();
    console.log("String.prototype.italics, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.italics, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.italics, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".lastIndexOf("an", 2.5);
    console.log("String.prototype.lastIndexOf, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 2147483647));
    console.log("String.prototype.lastIndexOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.lastIndexOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.lastIndexOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".lastIndexOf("an", 2.5);
    console.log("String.prototype.lastIndexOf, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 2147483647));
    console.log("String.prototype.lastIndexOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.lastIndexOf, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.lastIndexOf, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".length;
    console.log("String.prototype.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("String.prototype.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".length;
    console.log("String.prototype.length, get, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("String.prototype.length, get, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.length, get, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.length, get, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".link("an");
    console.log("String.prototype.link:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.link, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.link: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".link("an");
    console.log("String.prototype.link, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.link, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.link, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".localeCompare("an", "ar");
    console.log("String.prototype.localeCompare, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("String.prototype.localeCompare:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.localeCompare, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.localeCompare: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".localeCompare("an", "ar");
    console.log("String.prototype.localeCompare, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("String.prototype.localeCompare, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.localeCompare, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.localeCompare, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".localeCompare("an", 2.5, 3.5);
    console.log("String.prototype.localeCompare, form 3, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("String.prototype.localeCompare, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.localeCompare, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.localeCompare, form 3: it threw", error instanceof Error);
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
    const second = { first: 1.5, second: "two", third: item };
    const result = "banana".localeCompare("an", second, 3.5);
    console.log("String.prototype.localeCompare, form 4, is it an operand:", result === second);
    console.log("String.prototype.localeCompare, form 4, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("String.prototype.localeCompare, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.localeCompare, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.localeCompare, form 4: it threw", error instanceof Error);
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
    const result = "banana".localeCompare("an", item, item);
    console.log("String.prototype.localeCompare, form 5, is it an operand:", result === item, result === item);
    console.log("String.prototype.localeCompare, form 5, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("String.prototype.localeCompare, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.localeCompare, form 5, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.localeCompare, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".localeCompare("an", 2.5, 3.5);
    console.log("String.prototype.localeCompare, form 6, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 1));
    console.log("String.prototype.localeCompare, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.localeCompare, form 6, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.localeCompare, form 6: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
