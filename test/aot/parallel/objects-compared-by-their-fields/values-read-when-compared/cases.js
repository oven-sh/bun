import assert from "node:assert";
import { isDeepStrictEqual } from "node:util";

const symbol = Symbol("symbol");
class Record {
  constructor(a) {
    this.a = a;
    this.b = 5;
    this.c = 6;
  }
}
const literal = a => ({ a, b: 5, c: 6 });
const text = JSON.stringify({ a: null, b: 5, c: 6 });

// Ways to make an object with the keys a, b and c.
const makes = {
  "a literal": literal,
  "another literal": a => ({ a, b: 5, c: 6 }),
  "stores": a => {
    const object = {};
    object.a = a;
    object.b = 5;
    object.c = 6;
    return object;
  },
  "stores under computed keys": a => {
    const object = {};
    for (const key of ["a", "b", "c"]) object[key] = key === "a" ? a : key === "b" ? 5 : 6;
    return object;
  },
  "Object.fromEntries": a =>
    Object.fromEntries([
      ["a", a],
      ["b", 5],
      ["c", 6],
    ]),
  "JSON.parse": a => Object.assign(JSON.parse(text), { a }),
  "a spread": a => ({ ...literal(a) }),
  "Object.assign": a => Object.assign({}, literal(a)),
  "structuredClone": a => Object.assign(structuredClone({ a: null, b: 5, c: 6 }), { a }),
  "an instance": a => new Record(a),
  "an object without a prototype": a => Object.assign(Object.create(null), { a, b: 5, c: 6 }),
  "a literal with a deleted key": a => {
    const object = { a, z: 0, b: 5, c: 6 };
    delete object.z;
    return object;
  },
  "a literal with many keys": a => {
    const object = { a, b: 5, c: 6 };
    for (let i = 0; i < 20; i++) object["k" + i] = i;
    return object;
  },
  "a literal with a symbol key first": a => ({ [symbol]: 1, a, b: 5, c: 6 }),
  "a literal with a symbol key last": a => ({ a, b: 5, c: 6, [symbol]: 1 }),
  "a literal with an index": a => ({ 0: "zero", a, b: 5, c: 6 }),
  "a literal with a hidden key": a =>
    Object.defineProperty({ a, b: 5, c: 6 }, "hidden", { value: 1, enumerable: false }),
  "a literal with an accessor": a => ({
    a,
    b: 5,
    get c() {
      return 6;
    },
  }),
  "a Proxy": a => new Proxy({ a, b: 5, c: 6 }, {}),
  "a literal in another order": a => ({ c: 6, b: 5, a }),
};
const pairs = [
  ["a literal", "a literal"],
  ["a literal", "another literal"],
  ["a literal", "stores"],
  ["a literal", "stores under computed keys"],
  ["stores under computed keys", "stores under computed keys"],
  ["a literal", "Object.fromEntries"],
  ["Object.fromEntries", "a literal"],
  ["Object.fromEntries", "Object.fromEntries"],
  ["a literal", "JSON.parse"],
  ["JSON.parse", "JSON.parse"],
  ["a literal", "a spread"],
  ["a literal", "Object.assign"],
  ["a literal", "structuredClone"],
  ["structuredClone", "structuredClone"],
  ["an instance", "an instance"],
  ["an object without a prototype", "an object without a prototype"],
  ["a literal with a deleted key", "a literal with a deleted key"],
  ["a literal with a deleted key", "a literal"],
  ["a literal with many keys", "a literal with many keys"],
  ["a literal with a symbol key first", "a literal with a symbol key first"],
  ["a literal with a symbol key first", "a literal with a symbol key last"],
  ["a literal with an index", "a literal with an index"],
  ["a literal with a hidden key", "a literal"],
  ["a literal with an accessor", "a literal"],
  ["a literal", "a literal with an accessor"],
  ["a Proxy", "a literal"],
  ["a literal", "a Proxy"],
  ["a literal", "a literal in another order"],
  ["Object.fromEntries", "a literal in another order"],
];

// What the getter below `a` does to the operands, the first time it runs.
const effects = {
  "stores into b": ({ first }) => void (first.b = 99),
  "stores into b of the second": ({ second }) => void (second.b = 99),
  "stores into b what b holds": ({ first }) => void (first.b = 5),
  "stores into c of both": ({ first, second }) => void ((first.c = 99), (second.c = 99)),
  "deletes b": ({ first }) => void delete first.b,
  "deletes b of the second": ({ second }) => void delete second.b,
  "deletes b of both": ({ first, second }) => void (delete first.b, delete second.b),
  "deletes b and stores it again": ({ first }) => void (delete first.b, (first.b = 5)),
  "deletes c of the second above a prototype that has c": ({ second }) =>
    void (delete second.c, Object.setPrototypeOf(second, { c: 6 })),
  "adds a key": ({ first }) => void (first.d = 7),
  "adds many keys to both": ({ first, second }) => {
    for (let i = 0; i < 100; i++) first["n" + i] = second["n" + i] = i;
  },
  "makes b a getter": ({ first }) =>
    void Object.defineProperty(first, "b", { get: () => 5, enumerable: true, configurable: true }),
  "makes b of the second a getter of another value": ({ second }) =>
    void Object.defineProperty(second, "b", { get: () => 99, enumerable: true, configurable: true }),
  "makes b a getter that stores into c of the second": ({ first, second }) =>
    void Object.defineProperty(first, "b", { get: () => ((second.c = 99), 5), enumerable: true, configurable: true }),
  "hides b": ({ first }) => void Object.defineProperty(first, "b", { enumerable: false }),
  "hides b of the second": ({ second }) => void Object.defineProperty(second, "b", { enumerable: false }),
  "swaps b and c": ({ first }) => void ([first.b, first.c] = [first.c, first.b]),
  "stores under the symbol": ({ first }) => void (first[symbol] = 99),
  "does nothing": () => {},
};

const keysOf = object =>
  Reflect.ownKeys(object)
    .map(key => (typeof key === "symbol" ? "symbol" : key))
    .join(",");

function compared(firstMake, secondMake, change, getterIn, compare) {
  const operands = {};
  let calls = 0;
  const withGetter = {
    get v() {
      if (!calls++) change(operands);
      return 1;
    },
  };
  operands.first = makes[firstMake](getterIn === "first" ? withGetter : { v: 1 });
  operands.second = makes[secondMake](getterIn === "second" ? withGetter : { v: 1 });
  let answer;
  try {
    answer = compare(operands.first, operands.second);
  } catch (error) {
    answer = error.code ?? error.name;
  }
  return { answer, calls, keys: keysOf(operands.first) + " | " + keysOf(operands.second) };
}

// One line for each pair of makes, each effect and each operand that holds the getter: the answers of util.isDeepStrictEqual with
// and without the prototypes, whether assert.deepStrictEqual throws, how often the getter ran, and the keys of both objects afterwards.
export function* rows() {
  for (const [firstMake, secondMake] of pairs) {
    for (const [effect, change] of Object.entries(effects)) {
      for (const getterIn of ["first", "second"]) {
        const strict = compared(firstMake, secondMake, change, getterIn, (a, b) => isDeepStrictEqual(a, b));
        const withoutPrototypes = compared(firstMake, secondMake, change, getterIn, (a, b) =>
          isDeepStrictEqual(a, b, true),
        );
        const asserted = compared(
          firstMake,
          secondMake,
          change,
          getterIn,
          (a, b) => (assert.deepStrictEqual(a, b), "passes"),
        );
        yield `${firstMake} and ${secondMake}, a getter in the ${getterIn} ${effect}: ${strict.answer} ${withoutPrototypes.answer} ${asserted.answer}, ${strict.calls} ${strict.calls === 1 ? "call" : "calls"}, ${strict.keys}`;
      }
    }
  }
}

// Which comparison runs first: a Proxy below each key says when it is read.
export function* orders() {
  const log = [];
  const traced = name =>
    new Proxy(
      { v: 1 },
      {
        get(target, key, receiver) {
          if (key === "v") log.push(name);
          return Reflect.get(target, key, receiver);
        },
      },
    );
  const shapes = {
    "string keys": side => ({ a: traced(side + ".a"), b: traced(side + ".b"), c: traced(side + ".c") }),
    "a symbol key first": side => ({
      [symbol]: traced(side + ".symbol"),
      a: traced(side + ".a"),
      b: traced(side + ".b"),
    }),
    "a symbol key in the middle": side => ({
      a: traced(side + ".a"),
      [symbol]: traced(side + ".symbol"),
      b: traced(side + ".b"),
    }),
    "Object.fromEntries": side =>
      Object.fromEntries([
        ["a", traced(side + ".a")],
        ["b", traced(side + ".b")],
        ["c", traced(side + ".c")],
      ]),
    "another order": side => ({ c: traced(side + ".c"), b: traced(side + ".b"), a: traced(side + ".a") }),
    "an instance": side => new Record(traced(side + ".a")),
  };
  for (const [firstShape, secondShape] of [
    ["string keys", "string keys"],
    ["a symbol key first", "a symbol key first"],
    ["a symbol key in the middle", "a symbol key in the middle"],
    ["a symbol key first", "a symbol key in the middle"],
    ["string keys", "Object.fromEntries"],
    ["Object.fromEntries", "string keys"],
    ["string keys", "another order"],
    ["Object.fromEntries", "another order"],
    ["an instance", "an instance"],
  ]) {
    log.length = 0;
    const answer = isDeepStrictEqual(shapes[firstShape]("first"), shapes[secondShape]("second"));
    yield `${firstShape} and ${secondShape}: ${answer}, read in the order ${log.join(" ")}`;
  }
}

// Two objects whose keys differ by one name. A getter below an earlier key gives one object the key of the other, as a getter or as a value.
const withKeys = (count, last, k) => {
  const object = {};
  for (let i = 0; i < count; i++) object["t" + i] = i;
  for (const [key, value] of [
    ["k", k],
    [last, 1],
  ])
    object[key] = value;
  return object;
};
const storesWithA = k => {
  const object = {};
  for (const [key, value] of [
    ["k", k],
    ["a", 1],
    ["z", 5],
  ])
    object[key] = value;
  return object;
};
const storesWithB = k => {
  const object = {};
  for (const [key, value] of [
    ["k", k],
    ["b", 1],
    ["z", 5],
  ])
    object[key] = value;
  return object;
};
const getter = (object, key, value, called, enumerable = true) =>
  Object.defineProperty(object, key, { get: () => (called.push(key), value), enumerable, configurable: true });
const gained = {
  "the second gains a getter under the key of the first, the first gains the key of the second": (
    first,
    second,
    called,
  ) => {
    getter(second, "a", 1, called);
    first.b = 1;
  },
  "each gains a getter under the key of the other": (first, second, called) => {
    getter(second, "a", 1, called);
    getter(first, "b", 1, called);
  },
  "the second gains a getter that answers another value": (first, second, called) => {
    getter(second, "a", 2, called);
    first.b = 1;
  },
  "the second gains a getter that is not enumerable": (first, second, called) => {
    getter(second, "a", 1, called, false);
    first.b = 1;
  },
  "each gains the key of the other": (first, second) => {
    second.a = 1;
    first.b = 1;
  },
  "the second gains a getter under the key of the first": (first, second, called) => {
    getter(second, "a", 1, called);
  },
  "the first gains a getter under the key of the second": (first, second, called) => {
    getter(first, "b", 1, called);
  },
};

function gain(makeFirst, makeSecond, change, getterIn) {
  const called = [];
  let calls = 0;
  let first;
  let second;
  const withGetter = {
    get v() {
      if (!calls++) change(first, second, called);
      return 1;
    },
  };
  first = makeFirst(getterIn === "first" ? withGetter : { v: 1 });
  second = makeSecond(getterIn === "second" ? withGetter : { v: 1 });
  return `${isDeepStrictEqual(first, second)}, getters called: ${called.join(" ") || "none"}`;
}

export function* gains() {
  // The first object that a function makes with stores under computed keys is not made as the later ones are: here the second operand is that object, then it is not.
  for (let i = 0; i < 40; i++) isDeepStrictEqual(storesWithA({ v: 1 }), storesWithA({ v: 1 }));
  for (const time of ["first", "second"])
    yield `the ${time} object of its maker gains a getter: ${gain(storesWithA, storesWithB, gained["each gains a getter under the key of the other"], "first")}`;
  for (const count of [0, 200]) {
    for (const [name, change] of Object.entries(gained)) {
      for (const getterIn of ["first", "second"]) {
        const answer = gain(
          k => withKeys(count, "a", k),
          k => withKeys(count, "b", k),
          change,
          getterIn,
        );
        yield `${count} keys before k, ${name}, a getter in the ${getterIn}: ${answer}`;
      }
    }
  }
}
