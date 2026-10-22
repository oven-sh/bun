// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = DisposableStack.length;
    console.log("DisposableStack.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("DisposableStack.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DisposableStack.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = DisposableStack.name;
    console.log("DisposableStack.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt(1.5, callback);
    console.log("DisposableStack.prototype.adopt, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DisposableStack.prototype.adopt: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.call(subject, 1.5, callback);
    console.log("DisposableStack.prototype.adopt, by call, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, by call, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.apply(subject, [1.5, callback]);
    console.log("DisposableStack.prototype.adopt, by apply, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, by apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.adopt, subject, [1.5, callback]);
    console.log("DisposableStack.prototype.adopt, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, by Reflect.apply, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.bind(subject)(1.5, callback);
    console.log("DisposableStack.prototype.adopt, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, by a bound function, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt("an", callback);
    console.log("DisposableStack.prototype.adopt, form 6, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, form 6:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, form 6, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, form 6: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.call(subject, "an", callback);
    console.log("DisposableStack.prototype.adopt, form 6, by call, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, form 6, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, form 6, by call, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, form 6, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.apply(subject, ["an", callback]);
    console.log("DisposableStack.prototype.adopt, form 6, by apply, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, form 6, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, form 6, by apply, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, form 6, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = Reflect.apply(subject.adopt, subject, ["an", callback]);
    console.log("DisposableStack.prototype.adopt, form 6, by Reflect.apply, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, form 6, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, form 6, by Reflect.apply, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, form 6, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.adopt.bind(subject)("an", callback);
    console.log("DisposableStack.prototype.adopt, form 6, by a bound function, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.adopt, form 6, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.adopt, form 6, by a bound function, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.prototype.adopt, form 6, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    function callback() {
      return true;
    }
    const result = subject.defer(callback);
    console.log("DisposableStack.prototype.defer, is it an operand:", result === subject, result === callback);
    console.log("DisposableStack.prototype.defer:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DisposableStack.prototype.defer: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    const result = subject.dispose();
    console.log("DisposableStack.prototype.dispose, is it an operand:", result === subject);
    console.log("DisposableStack.prototype.dispose:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("DisposableStack.prototype.dispose: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    const result = subject.disposed;
    console.log("DisposableStack.prototype.disposed, get, is it an operand:", result === subject);
    console.log("DisposableStack.prototype.disposed, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.disposed, get, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("DisposableStack.prototype.disposed, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    const result = subject.move();
    console.log("DisposableStack.prototype.move, is it an operand:", result === subject);
    const again = subject.move();
    console.log("DisposableStack.prototype.move, does a second call answer the same thing:", result === again);
    console.log("DisposableStack.prototype.move:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype.move, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("DisposableStack.prototype.move, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("DisposableStack.prototype.move, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("DisposableStack.prototype.move, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    console.log("DisposableStack.prototype.move, how many keys:", Object.keys(result).length);
  } catch (error) {
    console.log("DisposableStack.prototype.move: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = new DisposableStack();
    const result = subject[Symbol.toStringTag];
    console.log("DisposableStack.prototype[Symbol.toStringTag], get, is it an operand:", result === subject);
    console.log("DisposableStack.prototype[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("DisposableStack.prototype[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("DisposableStack.prototype[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
