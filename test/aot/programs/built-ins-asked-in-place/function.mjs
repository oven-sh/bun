// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Function.length;
    console.log("Function.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Function.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Function.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Function.name;
    console.log("Function.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Function.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Function.prototype(1.5, "an");
    console.log("Function.prototype:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Function.prototype("an", "an");
    console.log("Function.prototype, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype, form 2: it threw", error instanceof Error);
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
    const result = Function.prototype(item, 1.5);
    console.log("Function.prototype, form 3, is it an operand:", result === item);
    console.log("Function.prototype, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Function.prototype(1.5, "an");
    console.log("Function.prototype, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype, form 4: it threw", error instanceof Error);
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
    const subject = function work(first, second) {
  return second;
};
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.apply(1.5, second);
    console.log("Function.prototype.apply, is it an operand:", result === subject, result === second);
    console.log("Function.prototype.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype.apply: it threw", error instanceof Error);
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
    const subject = function work(first, second) {
  return second;
};
    const second = { first: 1.5, second: "two", third: item };
    const result = subject.apply("an", second);
    console.log("Function.prototype.apply, form 2, is it an operand:", result === subject, result === second);
    console.log("Function.prototype.apply, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype.apply, form 2: it threw", error instanceof Error);
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
    const subject = function work(first, second) {
  return second;
};
    const result = subject.apply(item, item);
    console.log("Function.prototype.apply, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Function.prototype.apply, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Function.prototype.apply, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.bind(1.5, 2.5, "-");
    console.log("Function.prototype.bind, is it an operand:", result === subject);
    const again = subject.bind(1.5, 2.5, "-");
    console.log("Function.prototype.bind, does a second call answer the same thing:", result === again);
    console.log("Function.prototype.bind:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.bind, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Function.prototype.bind, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Function.prototype.bind, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Function.prototype.bind, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Function.prototype.bind, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Function.prototype.bind: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.bind("an", 2.5, "-");
    console.log("Function.prototype.bind, form 2, is it an operand:", result === subject);
    const again = subject.bind("an", 2.5, "-");
    console.log("Function.prototype.bind, form 2, does a second call answer the same thing:", result === again);
    console.log("Function.prototype.bind, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.bind, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Function.prototype.bind, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Function.prototype.bind, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Function.prototype.bind, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Function.prototype.bind, form 2, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Function.prototype.bind, form 2: it threw", error instanceof Error);
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
    const subject = function work(first, second) {
  return second;
};
    const result = subject.bind(item, item, 2.5);
    console.log("Function.prototype.bind, form 3, is it an operand:", result === subject, result === item, result === item);
    const again = subject.bind(item, item, 2.5);
    console.log("Function.prototype.bind, form 3, does a second call answer the same thing:", result === again);
    console.log("Function.prototype.bind, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.bind, form 3, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("Function.prototype.bind, form 3, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("Function.prototype.bind, form 3, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("Function.prototype.bind, form 3, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("Function.prototype.bind, form 3, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("Function.prototype.bind, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.call(1.5, 2.5, "-");
    console.log("Function.prototype.call, is it an operand:", result === subject);
    console.log("Function.prototype.call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.call, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Function.prototype.call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.call("an", 2.5, "-");
    console.log("Function.prototype.call, form 2, is it an operand:", result === subject);
    console.log("Function.prototype.call, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.call, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Function.prototype.call, form 2: it threw", error instanceof Error);
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
    const subject = function work(first, second) {
  return second;
};
    const result = subject.call(item, item, 2.5);
    console.log("Function.prototype.call, form 3, is it an operand:", result === subject, result === item, result === item);
    console.log("Function.prototype.call, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.call, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Function.prototype.call, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.length;
    console.log("Function.prototype.length, get, is it an operand:", result === subject);
    console.log("Function.prototype.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Function.prototype.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.name;
    console.log("Function.prototype.name, get, is it an operand:", result === subject);
    console.log("Function.prototype.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Function.prototype.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject.toString();
    console.log("Function.prototype.toString, is it an operand:", result === subject);
    console.log("Function.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Function.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject[Symbol.hasInstance](1.5);
    console.log("Function.prototype[Symbol.hasInstance], is it an operand:", result === subject);
    console.log("Function.prototype[Symbol.hasInstance]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype[Symbol.hasInstance], the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Function.prototype[Symbol.hasInstance]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = function work(first, second) {
  return second;
};
    const result = subject[Symbol.hasInstance]("an");
    console.log("Function.prototype[Symbol.hasInstance], form 2, is it an operand:", result === subject);
    console.log("Function.prototype[Symbol.hasInstance], form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype[Symbol.hasInstance], form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Function.prototype[Symbol.hasInstance], form 2: it threw", error instanceof Error);
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
    const subject = function work(first, second) {
  return second;
};
    const result = subject[Symbol.hasInstance](item);
    console.log("Function.prototype[Symbol.hasInstance], form 3, is it an operand:", result === subject, result === item);
    console.log("Function.prototype[Symbol.hasInstance], form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Function.prototype[Symbol.hasInstance], form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Function.prototype[Symbol.hasInstance], form 3: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
