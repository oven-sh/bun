// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const result = Symbol.asyncDispose;
    console.log("Symbol.asyncDispose, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.asyncDispose, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.asyncIterator;
    console.log("Symbol.asyncIterator, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.asyncIterator, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.dispose;
    console.log("Symbol.dispose, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.dispose, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.for("an");
    console.log("Symbol.for:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.for: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.for("an");
    console.log("Symbol.for, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.for, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.hasInstance;
    console.log("Symbol.hasInstance, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.hasInstance, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.isConcatSpreadable;
    console.log("Symbol.isConcatSpreadable, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.isConcatSpreadable, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.iterator;
    console.log("Symbol.iterator, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.iterator, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.keyFor(Symbol.for("name"));
    console.log("Symbol.keyFor:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.keyFor, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Symbol.keyFor: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.keyFor(Symbol.for("name"));
    console.log("Symbol.keyFor, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.keyFor, form 2, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Symbol.keyFor, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.length;
    console.log("Symbol.length, get, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 2147483647));
    console.log("Symbol.length, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.length, get, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Symbol.length, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.match;
    console.log("Symbol.match, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.match, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.matchAll;
    console.log("Symbol.matchAll, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.matchAll, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.name;
    console.log("Symbol.name, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.name, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Symbol.name, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.replace;
    console.log("Symbol.replace, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.replace, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.search;
    console.log("Symbol.search, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.search, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.species;
    console.log("Symbol.species, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.species, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.split;
    console.log("Symbol.split, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.split, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.toPrimitive;
    console.log("Symbol.toPrimitive, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.toPrimitive, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.toStringTag;
    console.log("Symbol.toStringTag, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.toStringTag, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Symbol.unscopables;
    console.log("Symbol.unscopables, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.unscopables, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject.description;
    console.log("Symbol.prototype.description, get, is it an operand:", result === subject);
    console.log("Symbol.prototype.description, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.prototype.description, get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Symbol.prototype.description, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject.toString();
    console.log("Symbol.prototype.toString, is it an operand:", result === subject);
    console.log("Symbol.prototype.toString:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Symbol.prototype.toString, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Symbol.prototype.toString: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject.valueOf();
    console.log("Symbol.prototype.valueOf, is it an operand:", result === subject);
    console.log("Symbol.prototype.valueOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype.valueOf: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject.valueOf.call(subject);
    console.log("Symbol.prototype.valueOf, by call, is it an operand:", result === subject);
    console.log("Symbol.prototype.valueOf, by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype.valueOf, by call: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject.valueOf.apply(subject, []);
    console.log("Symbol.prototype.valueOf, by apply, is it an operand:", result === subject);
    console.log("Symbol.prototype.valueOf, by apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype.valueOf, by apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = Reflect.apply(subject.valueOf, subject, []);
    console.log("Symbol.prototype.valueOf, by Reflect.apply, is it an operand:", result === subject);
    console.log("Symbol.prototype.valueOf, by Reflect.apply:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype.valueOf, by Reflect.apply: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject.valueOf.bind(subject)();
    console.log("Symbol.prototype.valueOf, by a bound function, is it an operand:", result === subject);
    console.log("Symbol.prototype.valueOf, by a bound function:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype.valueOf, by a bound function: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject[Symbol.toPrimitive]();
    console.log("Symbol.prototype[Symbol.toPrimitive], is it an operand:", result === subject);
    console.log("Symbol.prototype[Symbol.toPrimitive]:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype[Symbol.toPrimitive]: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const subject = Symbol.for("name");
    const result = subject[Symbol.toPrimitive].call(subject);
    console.log("Symbol.prototype[Symbol.toPrimitive], by call, is it an operand:", result === subject);
    console.log("Symbol.prototype[Symbol.toPrimitive], by call:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Symbol.prototype[Symbol.toPrimitive], by call: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
