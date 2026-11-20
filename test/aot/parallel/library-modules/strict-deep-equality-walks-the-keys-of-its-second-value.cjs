// util.isDeepStrictEqual and assert.deepStrictEqual walk the keys of their second value, string keys before symbol keys: which trap of a nested Proxy runs first and which of a difference and a throwing getter comes first, for object literals of the program, objects that the library made, and one of each. Then the answers for literals in another key order in which no key holds two different objects.
const util = require("node:util");
const assert = require("node:assert");

const log = [];
const traced = (name, target) =>
  new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === "string" && key !== "constructor") log.push(name + ".get:" + key);
      return Reflect.get(object, key, receiver);
    },
  });
const thrower = () => ({
  get x() {
    throw new RangeError("x");
  },
});
const parsed = (...entries) => {
  const object = JSON.parse("{}");
  for (const [key, value] of entries) object[key] = value;
  return object;
};
function tell(label, run) {
  log.length = 0;
  let answer;
  try {
    answer = JSON.stringify(run());
  } catch (error) {
    answer = "throws " + (error && error.name);
  }
  console.log(label + ": " + answer + " | " + log.join(" "));
}
const caught = run => {
  try {
    run();
    return "passes";
  } catch (error) {
    return error.name;
  }
};

tell("literals, traps", () => util.isDeepStrictEqual({ a: traced("1a", { v: 1 }), b: traced("1b", { v: 1 }) }, { b: traced("2b", { v: 1 }), a: traced("2a", { v: 1 }) }));
tell("literals, a difference before a throw", () => util.isDeepStrictEqual({ a: thrower(), b: 1 }, { b: 2, a: thrower() }));
tell("literals, a throw before a difference", () => util.isDeepStrictEqual({ b: 2, a: thrower() }, { a: thrower(), b: 1 }));
tell("literal and parsed, traps", () => util.isDeepStrictEqual({ a: traced("1a", { v: 1 }), b: traced("1b", { v: 1 }) }, parsed(["b", traced("2b", { v: 1 })], ["a", traced("2a", { v: 1 })])));
tell("parsed and literal, traps", () => util.isDeepStrictEqual(parsed(["a", traced("1a", { v: 1 })], ["b", traced("1b", { v: 1 })]), { b: traced("2b", { v: 1 }), a: traced("2a", { v: 1 }) }));
tell("literal and parsed, a difference before a throw", () => util.isDeepStrictEqual({ a: thrower(), b: 1 }, parsed(["b", 2], ["a", thrower()])));
tell("parsed, traps", () => util.isDeepStrictEqual(parsed(["a", traced("1a", { v: 1 })], ["b", traced("1b", { v: 1 })]), parsed(["b", traced("2b", { v: 1 })], ["a", traced("2a", { v: 1 })])));
tell("parsed, a difference before a throw", () => util.isDeepStrictEqual(parsed(["a", thrower()], ["b", 1]), parsed(["b", 2], ["a", thrower()])));
tell("parsed, a throw before a difference", () => util.isDeepStrictEqual(parsed(["b", 2], ["a", thrower()]), parsed(["a", thrower()], ["b", 1])));
tell("assert.deepStrictEqual", () => caught(() => assert.deepStrictEqual({ a: thrower(), b: 1 }, { b: 2, a: thrower() })));
tell("assert.deepStrictEqual, other order", () => caught(() => assert.deepStrictEqual({ b: 2, a: thrower() }, { a: thrower(), b: 1 })));
tell("assert.notDeepStrictEqual", () => caught(() => assert.notDeepStrictEqual({ a: thrower(), b: 1 }, { b: 2, a: thrower() })));
tell("assert.notDeepStrictEqual, other order", () => caught(() => assert.notDeepStrictEqual({ b: 2, a: thrower() }, { a: thrower(), b: 1 })));
tell("without prototypes", () => util.isDeepStrictEqual({ a: thrower(), b: 1 }, { b: 2, a: thrower() }, true));
tell("without prototypes, other order", () => util.isDeepStrictEqual({ b: 2, a: thrower() }, { a: thrower(), b: 1 }, true));
tell("assert.throws with an object", () => caught(() => assert.throws(() => { throw Object.assign(new Error("m"), { info: { a: thrower(), b: 1 } }); }, { info: { b: 2, a: thrower() } })));
tell("literals with the same key order, traps", () => util.isDeepStrictEqual({ a: traced("1a", { v: 1 }), b: traced("1b", { v: 1 }) }, { a: traced("2a", { v: 1 }), b: traced("2b", { v: 1 }) }));
class Point {
  constructor(side, first, second) {
    this[first] = traced(side + first, { v: 1 });
    this[second] = traced(side + second, { v: 1 });
  }
}
tell("instances of a class, traps", () => util.isDeepStrictEqual(new Point("1", "x", "y"), new Point("2", "y", "x")));
const symbol = Symbol("s");
tell("literals with a symbol key written first, traps", () => util.isDeepStrictEqual({ [symbol]: traced("1s", { v: 1 }), a: traced("1a", { v: 1 }) }, { [symbol]: traced("2s", { v: 1 }), a: traced("2a", { v: 1 }) }));
class Tagged {
  constructor(side) {
    this[symbol] = traced(side + "s", { v: 1 });
    this.a = traced(side + "a", { v: 1 });
  }
}
tell("instances of a class with a symbol key written first, traps", () => util.isDeepStrictEqual(new Tagged("1"), new Tagged("2")));
const letter = index => String.fromCharCode(97 + index);
const grown = side => {
  const object = { a: traced(side + "a", { v: 1 }) };
  object[symbol] = traced(side + "s", { v: 1 });
  object[letter(1)] = traced(side + "b", { v: 1 });
  return object;
};
tell("literals that get a symbol key and then a string key, traps", () => util.isDeepStrictEqual(grown("1"), grown("2")));
const spread = side => {
  const part = { [symbol]: traced(side + "s", { v: 1 }), b: traced(side + "b", { v: 1 }) };
  return { ...part, a: traced(side + "a", { v: 1 }) };
};
tell("literals that spread a symbol key before their string keys, traps", () => util.isDeepStrictEqual(spread("1"), spread("2")));
const other = Symbol("t");
const both = (first, second) => [util.isDeepStrictEqual(first, second), util.isDeepStrictEqual(second, first)];
tell("no object inside, another key order", () => both({ a: 1, b: "x", c: null }, { c: null, b: "x", a: 1 }));
tell("no object inside, another key order, 0 and -0", () => both({ a: 0, b: 1 }, { b: 1, a: -0 }));
tell("no object inside, another key order, a key is missing", () => both({ a: 1, b: 2 }, { b: 2, c: 1 }));
tell("no object inside, another key order, undefined and a missing key", () => both({ a: undefined, b: 2 }, { b: 2 }));
tell("no object inside, two symbol keys in another order", () => both({ [symbol]: 1, [other]: 2, a: 3 }, { a: 3, [other]: 2, [symbol]: 1 }));
tell("no object inside, another symbol key", () => both({ [symbol]: 1, a: 2 }, { a: 2, [other]: 1 }));
const shared = traced("shared", { v: 1 });
tell("one object under a key of both, another key order", () => both({ a: shared, b: 1 }, { b: 1, a: shared }));
tell("one object under a key of both, another key order, a difference", () => both({ a: shared, b: 1 }, { b: 2, a: shared }));
tell("an object against no object, another key order", () => both({ a: traced("1a", { v: 1 }), b: 1 }, { b: 1, a: null }));
tell("an object under a key that the other lacks, another key order", () => both({ a: traced("1a", { v: 1 }), b: 1 }, { b: 1, c: traced("2c", { v: 1 }) }));
tell("two objects under one key and a difference before them, another key order", () => both({ a: traced("1a", { v: 1 }), b: 1 }, { b: 2, a: traced("2a", { v: 1 }) }));
tell("two objects under one key and a difference behind them, another key order", () => both({ b: 1, a: traced("1a", { v: 1 }) }, { a: traced("2a", { v: 1 }), b: 2 }));
