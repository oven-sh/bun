// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
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
    const subject = new Uint8Array(0);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.find(callback, second);
    console.log("%TypedArray%.prototype.find, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.find, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.find, form 4: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.findIndex(callback, second);
    console.log("%TypedArray%.prototype.findIndex, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.findIndex, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findIndex:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findIndex, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findIndex: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.findIndex(callback, 2.5);
    console.log("%TypedArray%.prototype.findIndex, form 2, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.findIndex, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findIndex, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findIndex, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findIndex, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.findIndex(callback, item);
    console.log("%TypedArray%.prototype.findIndex, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("%TypedArray%.prototype.findIndex, form 3, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findIndex, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findIndex, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findIndex, form 3: it threw", error instanceof Error);
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
    const subject = new Uint8Array(0);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.findIndex(callback, second);
    console.log("%TypedArray%.prototype.findIndex, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.findIndex, form 4, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findIndex, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findIndex, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findIndex, form 4: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.findLast(callback, second);
    console.log("%TypedArray%.prototype.findLast, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.findLast:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLast, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLast: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.findLast(callback, 2.5);
    console.log("%TypedArray%.prototype.findLast, form 2, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.findLast, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLast, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLast, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.findLast(callback, item);
    console.log("%TypedArray%.prototype.findLast, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("%TypedArray%.prototype.findLast, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLast, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLast, form 3: it threw", error instanceof Error);
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
    const subject = new Uint8Array(0);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.findLast(callback, second);
    console.log("%TypedArray%.prototype.findLast, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.findLast, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLast, form 4: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.findLastIndex(callback, second);
    console.log("%TypedArray%.prototype.findLastIndex, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.findLastIndex, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findLastIndex:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLastIndex, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLastIndex: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.findLastIndex(callback, 2.5);
    console.log("%TypedArray%.prototype.findLastIndex, form 2, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.findLastIndex, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findLastIndex, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLastIndex, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLastIndex, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.findLastIndex(callback, item);
    console.log("%TypedArray%.prototype.findLastIndex, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("%TypedArray%.prototype.findLastIndex, form 3, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findLastIndex, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLastIndex, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLastIndex, form 3: it threw", error instanceof Error);
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
    const subject = new Uint8Array(0);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.findLastIndex(callback, second);
    console.log("%TypedArray%.prototype.findLastIndex, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.findLastIndex, form 4, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.findLastIndex, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.findLastIndex, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.findLastIndex, form 4: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, second);
    console.log("%TypedArray%.prototype.forEach, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.forEach:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.forEach: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, 2.5);
    console.log("%TypedArray%.prototype.forEach, form 2, is it an operand:", result === subject, result === callback);
    console.log("%TypedArray%.prototype.forEach, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.forEach, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, item);
    console.log("%TypedArray%.prototype.forEach, form 3, is it an operand:", result === subject, result === callback, result === item);
    console.log("%TypedArray%.prototype.forEach, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.forEach, form 3: it threw", error instanceof Error);
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
    const subject = new Uint8Array(0);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = subject.forEach(callback, second);
    console.log("%TypedArray%.prototype.forEach, form 4, is it an operand:", result === subject, result === callback, result === second);
    console.log("%TypedArray%.prototype.forEach, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%TypedArray%.prototype.forEach, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.includes(1.5, 2);
    console.log("%TypedArray%.prototype.includes, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.includes:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.includes, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.includes: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.includes("an", 2);
    console.log("%TypedArray%.prototype.includes, form 2, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.includes, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.includes, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.includes, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.includes(item, 2);
    console.log("%TypedArray%.prototype.includes, form 3, is it an operand:", result === subject, result === item);
    console.log("%TypedArray%.prototype.includes, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.includes, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.includes, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.includes(1.5, 2);
    console.log("%TypedArray%.prototype.includes, form 4, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.includes, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.includes, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("%TypedArray%.prototype.includes, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.indexOf(1.5, 2);
    console.log("%TypedArray%.prototype.indexOf, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.indexOf, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.indexOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.indexOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.indexOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.indexOf("an", 2);
    console.log("%TypedArray%.prototype.indexOf, form 2, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.indexOf, form 2, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.indexOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.indexOf, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.indexOf, form 2: it threw", error instanceof Error);
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
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.indexOf(item, 2);
    console.log("%TypedArray%.prototype.indexOf, form 3, is it an operand:", result === subject, result === item);
    console.log("%TypedArray%.prototype.indexOf, form 3, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.indexOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.indexOf, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.indexOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.indexOf(1.5, 2);
    console.log("%TypedArray%.prototype.indexOf, form 4, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.indexOf, form 4, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.indexOf, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.indexOf, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.indexOf, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.join("an");
    console.log("%TypedArray%.prototype.join, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.join:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.join, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%TypedArray%.prototype.join: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.join("an");
    console.log("%TypedArray%.prototype.join, form 2, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.join, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.join, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("%TypedArray%.prototype.join, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.keys();
    console.log("%TypedArray%.prototype.keys, is it an operand:", result === subject);
    const again = subject.keys();
    console.log("%TypedArray%.prototype.keys, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.keys:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.keys, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.keys, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.keys, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.keys, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.keys, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.keys, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.keys, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.keys: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array(0);
    const result = subject.keys();
    console.log("%TypedArray%.prototype.keys, form 2, is it an operand:", result === subject);
    const again = subject.keys();
    console.log("%TypedArray%.prototype.keys, form 2, does a second call answer the same thing:", result === again);
    console.log("%TypedArray%.prototype.keys, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.keys, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("%TypedArray%.prototype.keys, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("%TypedArray%.prototype.keys, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("%TypedArray%.prototype.keys, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("%TypedArray%.prototype.keys, form 2, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of result) {
        if (asked++ === 4) break;
        console.log("%TypedArray%.prototype.keys, form 2, by for-of:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null, Array.isArray(value));
        if (Array.isArray(value)) console.log("%TypedArray%.prototype.keys, form 2, by for-of, the pair:", typeof value[0] === "undefined", typeof value[0] === "boolean", typeof value[0] === "number", typeof value[0] === "string", typeof value[0] === "bigint", typeof value[0] === "symbol", typeof value[0] === "function", typeof value[0] === "object", value[0] === null, typeof value[1] === "undefined", typeof value[1] === "boolean", typeof value[1] === "number", typeof value[1] === "string", typeof value[1] === "bigint", typeof value[1] === "symbol", typeof value[1] === "function", typeof value[1] === "object", value[1] === null);
      }
    }
  } catch (error) {
    console.log("%TypedArray%.prototype.keys, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new Uint8Array([1, 2, 3]);
    const result = subject.lastIndexOf(1.5, 2);
    console.log("%TypedArray%.prototype.lastIndexOf, is it an operand:", result === subject);
    console.log("%TypedArray%.prototype.lastIndexOf, does it lie where its row says:", typeof result !== "number" || (result >= -1 && result <= 4294967296));
    console.log("%TypedArray%.prototype.lastIndexOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("%TypedArray%.prototype.lastIndexOf, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("%TypedArray%.prototype.lastIndexOf: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
