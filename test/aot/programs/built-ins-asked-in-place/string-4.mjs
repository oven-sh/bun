// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = "banana".replace("an", "-");
    console.log("String.prototype.replace, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".replace("an", "-");
    console.log("String.prototype.replace, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 6, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replace(null, 2.5);
    console.log("String.prototype.replace, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 7, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replace(null, "-");
    console.log("String.prototype.replace, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 8, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 8: it threw", error instanceof Error);
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
    const result = "banana".replace(null, item);
    console.log("String.prototype.replace, form 9, is it an operand:", result === item);
    console.log("String.prototype.replace, form 9:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 9, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 9: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".replace(null, 2.5);
    console.log("String.prototype.replace, form 10:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 10, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 10: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replace(1.5, 2.5);
    console.log("String.prototype.replace, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 11, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 11: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replace("an", 2.5);
    console.log("String.prototype.replace, form 12:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 12, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 12: it threw", error instanceof Error);
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
    const result = "banana".replace(item, item);
    console.log("String.prototype.replace, form 13, is it an operand:", result === item, result === item);
    console.log("String.prototype.replace, form 13:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 13, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 13: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".replace(1.5, 2.5);
    console.log("String.prototype.replace, form 14:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replace, form 14, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replace, form 14: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".replaceAll(first, 2.5);
    console.log("String.prototype.replaceAll, is it an operand:", result === first);
    console.log("String.prototype.replaceAll:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".replaceAll(first, "-");
    console.log("String.prototype.replaceAll, form 2, is it an operand:", result === first);
    console.log("String.prototype.replaceAll, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 2: it threw", error instanceof Error);
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
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".replaceAll(first, item);
    console.log("String.prototype.replaceAll, form 3, is it an operand:", result === first, result === item);
    console.log("String.prototype.replaceAll, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 3, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "".replaceAll(first, 2.5);
    console.log("String.prototype.replaceAll, form 4, is it an operand:", result === first);
    console.log("String.prototype.replaceAll, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 4, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replaceAll("an", "-");
    console.log("String.prototype.replaceAll, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 5, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".replaceAll("an", "-");
    console.log("String.prototype.replaceAll, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 6, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replaceAll(null, 2.5);
    console.log("String.prototype.replaceAll, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 7, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 7: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replaceAll(null, "-");
    console.log("String.prototype.replaceAll, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 8, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 8: it threw", error instanceof Error);
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
    const result = "banana".replaceAll(null, item);
    console.log("String.prototype.replaceAll, form 9, is it an operand:", result === item);
    console.log("String.prototype.replaceAll, form 9:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 9, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 9: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".replaceAll(null, 2.5);
    console.log("String.prototype.replaceAll, form 10:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 10, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 10: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replaceAll(1.5, 2.5);
    console.log("String.prototype.replaceAll, form 11:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 11, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 11: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".replaceAll("an", 2.5);
    console.log("String.prototype.replaceAll, form 12:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 12, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 12: it threw", error instanceof Error);
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
    const result = "banana".replaceAll(item, item);
    console.log("String.prototype.replaceAll, form 13, is it an operand:", result === item, result === item);
    console.log("String.prototype.replaceAll, form 13:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 13, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 13: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".replaceAll(1.5, 2.5);
    console.log("String.prototype.replaceAll, form 14:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.replaceAll, form 14, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.replaceAll, form 14: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "banana".search(first);
    console.log("String.prototype.search, is it an operand:", result === first);
    console.log("String.prototype.search, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 2147483647));
    console.log("String.prototype.search:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.search, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.search: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
    const result = "".search(first);
    console.log("String.prototype.search, form 2, is it an operand:", result === first);
    console.log("String.prototype.search, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 2147483647));
    console.log("String.prototype.search, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.search, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.search, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".search(1.5);
    console.log("String.prototype.search, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.search, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.search, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".search("an");
    console.log("String.prototype.search, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.search, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.search, form 4: it threw", error instanceof Error);
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
    const result = "banana".search(item);
    console.log("String.prototype.search, form 5, is it an operand:", result === item);
    console.log("String.prototype.search, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.search, form 5, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.search, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".search(1.5);
    console.log("String.prototype.search, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.search, form 6, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("String.prototype.search, form 6: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
