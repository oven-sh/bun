// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = String.fromCharCode(1.5, 1);
    console.log("String.fromCharCode:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.fromCharCode, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.fromCharCode: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = String.fromCharCode(1.5, 1);
    console.log("String.fromCharCode, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.fromCharCode, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.fromCharCode, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = String.fromCodePoint();
    console.log("String.fromCodePoint:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.fromCodePoint, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.fromCodePoint: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = String.fromCodePoint();
    console.log("String.fromCodePoint, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.fromCodePoint, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.fromCodePoint, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = String.length;
    console.log("String.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("String.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = String.name;
    console.log("String.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".anchor("an");
    console.log("String.prototype.anchor:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.anchor, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.anchor: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".anchor("an");
    console.log("String.prototype.anchor, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.anchor, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.anchor, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".at(-1);
    console.log("String.prototype.at:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.at, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.at: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".at(-1);
    console.log("String.prototype.at, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.at, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".big();
    console.log("String.prototype.big:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.big, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.big: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".big();
    console.log("String.prototype.big, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.big, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.big, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".blink();
    console.log("String.prototype.blink:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.blink, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.blink: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".blink();
    console.log("String.prototype.blink, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.blink, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.blink, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".bold();
    console.log("String.prototype.bold:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.bold, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.bold: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".bold();
    console.log("String.prototype.bold, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.bold, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.bold, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".charAt(1);
    console.log("String.prototype.charAt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.charAt, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.charAt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".charAt(1);
    console.log("String.prototype.charAt, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.charAt, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.charAt, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".charCodeAt(1);
    console.log("String.prototype.charCodeAt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.charCodeAt, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.charCodeAt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".charCodeAt(1);
    console.log("String.prototype.charCodeAt, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.charCodeAt, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.charCodeAt, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".codePointAt(1);
    console.log("String.prototype.codePointAt, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 1114111));
    console.log("String.prototype.codePointAt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.codePointAt, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.codePointAt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".codePointAt(1);
    console.log("String.prototype.codePointAt, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 1114111));
    console.log("String.prototype.codePointAt, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.codePointAt, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".concat("an", "utf8");
    console.log("String.prototype.concat:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.concat, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.concat: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".concat("an", "utf8");
    console.log("String.prototype.concat, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.concat, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.concat, form 2: it threw", error instanceof Error);
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
    const result = "banana".endsWith(first, 2.5);
    console.log("String.prototype.endsWith, is it an operand:", result === first);
    console.log("String.prototype.endsWith:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.endsWith, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.endsWith: it threw", error instanceof Error);
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
    const result = "banana".endsWith(first, 2.5);
    console.log("String.prototype.endsWith, form 2, is it an operand:", result === first);
    console.log("String.prototype.endsWith, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.endsWith, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.endsWith, form 2: it threw", error instanceof Error);
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
    const result = "banana".endsWith(first, item);
    console.log("String.prototype.endsWith, form 3, is it an operand:", result === first, result === item);
    console.log("String.prototype.endsWith, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.endsWith, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.endsWith, form 3: it threw", error instanceof Error);
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
    const result = "".endsWith(first, 2.5);
    console.log("String.prototype.endsWith, form 4, is it an operand:", result === first);
    console.log("String.prototype.endsWith, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.endsWith, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.endsWith, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".endsWith("an", 2);
    console.log("String.prototype.endsWith, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.endsWith, form 5, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.endsWith, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".endsWith("an", 2);
    console.log("String.prototype.endsWith, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.endsWith, form 6, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("String.prototype.endsWith, form 6: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
