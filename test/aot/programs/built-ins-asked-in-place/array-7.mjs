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
    const list = [1.5, item, "two"];
    const result = list.push("an", "an");
    console.log("Array.prototype.push, form 2, is it an operand:", result === list);
    console.log("Array.prototype.push, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Array.prototype.push, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.push, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Array.prototype.push, form 2: it threw", error instanceof Error);
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
    const list = [item, item, item];
    const result = list.push(item, 1.5);
    console.log("Array.prototype.push, form 3, is it an operand:", result === list, result === item);
    console.log("Array.prototype.push, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Array.prototype.push, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.push, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Array.prototype.push, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const list = [];
    const result = list.push(1.5, "an");
    console.log("Array.prototype.push, form 4, is it an operand:", result === list);
    console.log("Array.prototype.push, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Array.prototype.push, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.push, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Array.prototype.push, form 4: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.push(1.5, "an");
    console.log("Array.prototype.push, form 5, is it an operand:", result === list);
    console.log("Array.prototype.push, form 5, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 9007199254740991));
    console.log("Array.prototype.push, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.push, form 5, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Array.prototype.push, form 5: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.push("an", "an");
    console.log("Array.prototype.push, form 6, is it an operand:", result === list);
    console.log("Array.prototype.push, form 6, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 9007199254740991));
    console.log("Array.prototype.push, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.push, form 6, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Array.prototype.push, form 6: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.push(item, 1.5);
    console.log("Array.prototype.push, form 7, is it an operand:", result === list, result === item);
    console.log("Array.prototype.push, form 7, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 9007199254740991));
    console.log("Array.prototype.push, form 7:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.push, form 7, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Array.prototype.push, form 7: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce(callback);
    console.log("Array.prototype.reduce, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce: it threw", error instanceof Error);
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
    const list = [item, item, item];
    function callback() {
      return true;
    }
    const result = list.reduce(callback);
    console.log("Array.prototype.reduce, form 2, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 2: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce(callback, second);
    console.log("Array.prototype.reduce, form 3, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 3: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce.call(list, callback, second);
    console.log("Array.prototype.reduce, form 3, by call, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 3, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 3, by call, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 3, by call: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce.apply(list, [callback, second]);
    console.log("Array.prototype.reduce, form 3, by apply, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 3, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 3, by apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 3, by apply: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = Reflect.apply(list.reduce, list, [callback, second]);
    console.log("Array.prototype.reduce, form 3, by Reflect.apply, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 3, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 3, by Reflect.apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 3, by Reflect.apply: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce.bind(list)(callback, second);
    console.log("Array.prototype.reduce, form 3, by a bound function, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 3, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 3, by a bound function, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 3, by a bound function: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce(callback, 2.5);
    console.log("Array.prototype.reduce, form 8, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce, form 8:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 8, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 8: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce.call(list, callback, 2.5);
    console.log("Array.prototype.reduce, form 8, by call, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce, form 8, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 8, by call, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 8, by call: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce.apply(list, [callback, 2.5]);
    console.log("Array.prototype.reduce, form 8, by apply, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce, form 8, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 8, by apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 8, by apply: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = Reflect.apply(list.reduce, list, [callback, 2.5]);
    console.log("Array.prototype.reduce, form 8, by Reflect.apply, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce, form 8, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 8, by Reflect.apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 8, by Reflect.apply: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce.bind(list)(callback, 2.5);
    console.log("Array.prototype.reduce, form 8, by a bound function, is it an operand:", result === list, result === callback);
    console.log("Array.prototype.reduce, form 8, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 8, by a bound function, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 8, by a bound function: it threw", error instanceof Error);
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
    const list = [item, item, item];
    function callback() {
      return true;
    }
    const result = list.reduce(callback, item);
    console.log("Array.prototype.reduce, form 13, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 13:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 13, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 13: it threw", error instanceof Error);
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
    const list = [item, item, item];
    function callback() {
      return true;
    }
    const result = list.reduce.call(list, callback, item);
    console.log("Array.prototype.reduce, form 13, by call, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 13, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 13, by call, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 13, by call: it threw", error instanceof Error);
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
    const list = [item, item, item];
    function callback() {
      return true;
    }
    const result = list.reduce.apply(list, [callback, item]);
    console.log("Array.prototype.reduce, form 13, by apply, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 13, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 13, by apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 13, by apply: it threw", error instanceof Error);
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
    const list = [item, item, item];
    function callback() {
      return true;
    }
    const result = Reflect.apply(list.reduce, list, [callback, item]);
    console.log("Array.prototype.reduce, form 13, by Reflect.apply, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 13, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 13, by Reflect.apply, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 13, by Reflect.apply: it threw", error instanceof Error);
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
    const list = [item, item, item];
    function callback() {
      return true;
    }
    const result = list.reduce.bind(list)(callback, item);
    console.log("Array.prototype.reduce, form 13, by a bound function, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 13, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 13, by a bound function, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 13, by a bound function: it threw", error instanceof Error);
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
    const list = [];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce(callback, second);
    console.log("Array.prototype.reduce, form 18, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 18:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 18, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array.prototype.reduce, form 18, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array.prototype.reduce, form 18, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array.prototype.reduce, form 18, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array.prototype.reduce, form 18, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Array.prototype.reduce, form 18.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Array.prototype.reduce, form 18.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Array.prototype.reduce, form 18.second, the text:", result.second.length === 0, result.second === "");
    console.log("Array.prototype.reduce, form 18.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Array.prototype.reduce, form 18.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Array.prototype.reduce, form 18.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Array.prototype.reduce, form 18.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Array.prototype.reduce, form 18.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Array.prototype.reduce, form 18.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Array.prototype.reduce, form 18.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Array.prototype.reduce, form 18: it threw", error instanceof Error);
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
    const list = [];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce.call(list, callback, second);
    console.log("Array.prototype.reduce, form 18, by call, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 18, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 18, by call, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array.prototype.reduce, form 18, by call, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array.prototype.reduce, form 18, by call, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array.prototype.reduce, form 18, by call, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array.prototype.reduce, form 18, by call, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by call, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by call, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by call, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by call.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Array.prototype.reduce, form 18, by call.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Array.prototype.reduce, form 18, by call.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Array.prototype.reduce, form 18, by call.second, the text:", result.second.length === 0, result.second === "");
    console.log("Array.prototype.reduce, form 18, by call.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Array.prototype.reduce, form 18, by call.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Array.prototype.reduce, form 18, by call.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Array.prototype.reduce, form 18, by call.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Array.prototype.reduce, form 18, by call.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Array.prototype.reduce, form 18, by call.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by call.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by call.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by call.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by call.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Array.prototype.reduce, form 18, by call.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Array.prototype.reduce, form 18, by call: it threw", error instanceof Error);
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
    const list = [];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce.apply(list, [callback, second]);
    console.log("Array.prototype.reduce, form 18, by apply, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 18, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 18, by apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array.prototype.reduce, form 18, by apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array.prototype.reduce, form 18, by apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array.prototype.reduce, form 18, by apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array.prototype.reduce, form 18, by apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Array.prototype.reduce, form 18, by apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Array.prototype.reduce, form 18, by apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Array.prototype.reduce, form 18, by apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Array.prototype.reduce, form 18, by apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Array.prototype.reduce, form 18, by apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Array.prototype.reduce, form 18, by apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Array.prototype.reduce, form 18, by apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Array.prototype.reduce, form 18, by apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Array.prototype.reduce, form 18, by apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Array.prototype.reduce, form 18, by apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Array.prototype.reduce, form 18, by apply: it threw", error instanceof Error);
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
    const list = [];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = Reflect.apply(list.reduce, list, [callback, second]);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array.prototype.reduce, form 18, by Reflect.apply, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array.prototype.reduce, form 18, by Reflect.apply, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Reflect.apply, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Reflect.apply, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Reflect.apply, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.second, the text:", result.second.length === 0, result.second === "");
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by Reflect.apply.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Array.prototype.reduce, form 18, by Reflect.apply.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Array.prototype.reduce, form 18, by Reflect.apply: it threw", error instanceof Error);
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
    const list = [];
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = list.reduce.bind(list)(callback, second);
    console.log("Array.prototype.reduce, form 18, by a bound function, is it an operand:", result === list, result === callback, result === second);
    console.log("Array.prototype.reduce, form 18, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 18, by a bound function, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Array.prototype.reduce, form 18, by a bound function, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Array.prototype.reduce, form 18, by a bound function, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Array.prototype.reduce, form 18, by a bound function, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Array.prototype.reduce, form 18, by a bound function, how many keys:", Object.keys(result).length);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by a bound function, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by a bound function, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by a bound function, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by a bound function.first:", typeof result.first === "undefined", typeof result.first === "boolean", typeof result.first === "number", typeof result.first === "string", typeof result.first === "bigint", typeof result.first === "symbol", typeof result.first === "function", typeof result.first === "object", result.first === null);
    console.log("Array.prototype.reduce, form 18, by a bound function.first, the number:", Number.isInteger(result.first), result.first === result.first, result.first < 0, result.first > 2147483647, result.first < -2147483648, Object.is(result.first, -0), (result.first | 0) === result.first);
    console.log("Array.prototype.reduce, form 18, by a bound function.second:", typeof result.second === "undefined", typeof result.second === "boolean", typeof result.second === "number", typeof result.second === "string", typeof result.second === "bigint", typeof result.second === "symbol", typeof result.second === "function", typeof result.second === "object", result.second === null);
    console.log("Array.prototype.reduce, form 18, by a bound function.second, the text:", result.second.length === 0, result.second === "");
    console.log("Array.prototype.reduce, form 18, by a bound function.third:", typeof result.third === "undefined", typeof result.third === "boolean", typeof result.third === "number", typeof result.third === "string", typeof result.third === "bigint", typeof result.third === "symbol", typeof result.third === "function", typeof result.third === "object", result.third === null);
    console.log("Array.prototype.reduce, form 18, by a bound function.third, the class:", Array.isArray(result.third), result.third instanceof Object, result.third instanceof Array, result.third instanceof Map, result.third instanceof Set, result.third instanceof Promise, result.third instanceof Date, result.third instanceof RegExp, result.third instanceof Error, result.third instanceof ArrayBuffer, result.third instanceof Uint8Array, result.third instanceof Function, ArrayBuffer.isView(result.third));
    console.log("Array.prototype.reduce, form 18, by a bound function.third, above it:", Object.getPrototypeOf(result.third) === Object.prototype, Object.getPrototypeOf(result.third) === Array.prototype, Object.getPrototypeOf(result.third) === null);
    console.log("Array.prototype.reduce, form 18, by a bound function.third, its state:", Object.isFrozen(result.third), Object.isSealed(result.third), Object.isExtensible(result.third));
    console.log("Array.prototype.reduce, form 18, by a bound function.third, names in it:", "length" in result.third, "size" in result.third, "then" in result.third, "next" in result.third, "constructor" in result.third, Symbol.iterator in result.third);
    console.log("Array.prototype.reduce, form 18, by a bound function.third, how many keys:", Object.keys(result.third).length);
    {
      let asked = 0;
      for (const value of Object.values(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by a bound function.third, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result.third)) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by a bound function.third, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result.third) {
        if (asked++ === 4) break;
        console.log("Array.prototype.reduce, form 18, by a bound function.third, by for-in:", typeof key === "string", typeof result.third[key] === "undefined", typeof result.third[key] === "boolean", typeof result.third[key] === "number", typeof result.third[key] === "string", typeof result.third[key] === "bigint", typeof result.third[key] === "symbol", typeof result.third[key] === "function", typeof result.third[key] === "object", result.third[key] === null);
      }
    }
    console.log("Array.prototype.reduce, form 18, by a bound function.third.size:", typeof result.third.size === "undefined", typeof result.third.size === "boolean", typeof result.third.size === "number", typeof result.third.size === "string", typeof result.third.size === "bigint", typeof result.third.size === "symbol", typeof result.third.size === "function", typeof result.third.size === "object", result.third.size === null);
    console.log("Array.prototype.reduce, form 18, by a bound function.third.size, the number:", Number.isInteger(result.third.size), result.third.size === result.third.size, result.third.size < 0, result.third.size > 2147483647, result.third.size < -2147483648, Object.is(result.third.size, -0), (result.third.size | 0) === result.third.size);
  } catch (error) {
    console.log("Array.prototype.reduce, form 18, by a bound function: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce(callback, item);
    console.log("Array.prototype.reduce, form 23, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 23:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 23, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 23: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    function callback() {
      return true;
    }
    const result = list.reduce.call(list, callback, item);
    console.log("Array.prototype.reduce, form 23, by call, is it an operand:", result === list, result === callback, result === item);
    console.log("Array.prototype.reduce, form 23, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Array.prototype.reduce, form 23, by call, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Array.prototype.reduce, form 23, by call: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
