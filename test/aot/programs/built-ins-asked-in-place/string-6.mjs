// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = "banana".sup();
    console.log("String.prototype.sup:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.sup, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.sup: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".sup();
    console.log("String.prototype.sup, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.sup, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.sup, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLocaleLowerCase("ar");
    console.log("String.prototype.toLocaleLowerCase:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleLowerCase: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toLocaleLowerCase("ar");
    console.log("String.prototype.toLocaleLowerCase, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleLowerCase, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLocaleLowerCase(1.5);
    console.log("String.prototype.toLocaleLowerCase, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleLowerCase, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLocaleLowerCase("an");
    console.log("String.prototype.toLocaleLowerCase, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleLowerCase, form 4: it threw", error instanceof Error);
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
    const result = "banana".toLocaleLowerCase(item);
    console.log("String.prototype.toLocaleLowerCase, form 5, is it an operand:", result === item);
    console.log("String.prototype.toLocaleLowerCase, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleLowerCase, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toLocaleLowerCase(1.5);
    console.log("String.prototype.toLocaleLowerCase, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleLowerCase, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLocaleUpperCase("ar");
    console.log("String.prototype.toLocaleUpperCase:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleUpperCase: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toLocaleUpperCase("ar");
    console.log("String.prototype.toLocaleUpperCase, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleUpperCase, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLocaleUpperCase(1.5);
    console.log("String.prototype.toLocaleUpperCase, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleUpperCase, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLocaleUpperCase("an");
    console.log("String.prototype.toLocaleUpperCase, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleUpperCase, form 4: it threw", error instanceof Error);
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
    const result = "banana".toLocaleUpperCase(item);
    console.log("String.prototype.toLocaleUpperCase, form 5, is it an operand:", result === item);
    console.log("String.prototype.toLocaleUpperCase, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleUpperCase, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toLocaleUpperCase(1.5);
    console.log("String.prototype.toLocaleUpperCase, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("String.prototype.toLocaleUpperCase, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toLowerCase();
    console.log("String.prototype.toLowerCase:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toLowerCase, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toLowerCase: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toLowerCase();
    console.log("String.prototype.toLowerCase, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toLowerCase, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toLowerCase, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toString();
    console.log("String.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toString();
    console.log("String.prototype.toString, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toString, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toString, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toUpperCase();
    console.log("String.prototype.toUpperCase:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toUpperCase, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toUpperCase: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toUpperCase();
    console.log("String.prototype.toUpperCase, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toUpperCase, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toUpperCase, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".toWellFormed();
    console.log("String.prototype.toWellFormed:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toWellFormed, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toWellFormed: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".toWellFormed();
    console.log("String.prototype.toWellFormed, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.toWellFormed, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.toWellFormed, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".trim();
    console.log("String.prototype.trim:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.trim, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.trim: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".trim();
    console.log("String.prototype.trim, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.trim, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.trim, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".trimEnd();
    console.log("String.prototype.trimEnd:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.trimEnd, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.trimEnd: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".trimEnd();
    console.log("String.prototype.trimEnd, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.trimEnd, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.trimEnd, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".trimStart();
    console.log("String.prototype.trimStart:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.trimStart, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.trimStart: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".trimStart();
    console.log("String.prototype.trimStart, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.trimStart, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.trimStart, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "banana".valueOf();
    console.log("String.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.valueOf, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.valueOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = "".valueOf();
    console.log("String.prototype.valueOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("String.prototype.valueOf, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("String.prototype.valueOf, form 2: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
