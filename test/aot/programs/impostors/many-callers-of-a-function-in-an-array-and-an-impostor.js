function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value !== "object" || value === null) return String(value);
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const notLists = [
  ["a string", () => "12"],
  ["a Set", () => new Set([1, 2])],
  ["a Map", () => new Map([[1, 2]])],
  ["a generator", () => (function* () { yield 1; yield 2; })()],
  ["a typed array", () => new Int8Array([1, -2])],
  ["an array with its own iterator", () => Object.assign([1, 2], { [Symbol.iterator]: () => [7][Symbol.iterator]() })],
  ["an array-like object", () => ({ 0: 1, length: 1 })],
  ["undefined", () => undefined],
];

const notTexts = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with indexOf", () => ({ indexOf: what => "asked for " + what })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a number", () => 12],
  ["null", () => null],
];

const notNumbers = [
  ["a numeric string", () => "3"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
  ["a BigInt", () => 3n],
  ["an array of one", () => [4]],
  ["true", () => true],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notPoints = [
  ["getters in the other order", () => ({ get y() { log.push("y"); return 1; }, get x() { log.push("x"); return 3; } })],
  ["a proxy", () => new Proxy({ x: 3, y: 1 }, { get: (target, key) => (log.push(String(key)), target[key]) })],
  ["members on the prototype", () => Object.create({ x: 3, y: 1 })],
  ["x is missing", () => ({ y: 1 })],
  ["strings inside", () => ({ x: "3", y: "1" })],
  ["an array", () => [3, 1]],
  ["a number", () => 5],
  ["null", () => null],
];

const table = [
  function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  },

  function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  },

  function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  },

  function (text) {
    return text.indexOf("b");
  },

  function (text) {
    return text.indexOf("b");
  },

  function (text) {
    return text.indexOf("b");
  },

  function (n) {
    return n * 2;
  },

  function (n) {
    return n * 2;
  },

  function (n) {
    return n * 2;
  },

  function (point) {
    const { x, y } = point;
    return x - y;
  },

  function (point) {
    const { x, y } = point;
    return x - y;
  },

  function (point) {
    const { x, y } = point;
    return x - y;
  },
];

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", table[1]([1, 2, 3]), table[1]([]), table[1](new Array(4, 5)), table[1]([0.5]), table[1](Array.of(6)));
for (let i = 0; i < 2000; i++) table[2]([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => table[0](make()));
  attempt("sumAsCallback " + name, () => [make()].map(table[1])[0]);
  attempt("sumHidden " + name, () => new Function("table", "value", "return table[2](value)")(table, make()));
}
console.log("after", "sumPlainly", table[0]([1, 2, 3]), table[0]([]), table[0](new Array(4, 5)), table[0]([0.5]), table[0](Array.of(6)));
console.log("after", "sumAsCallback", table[1]([1, 2, 3]), table[1]([]), table[1](new Array(4, 5)), table[1]([0.5]), table[1](Array.of(6)));
console.log("after", "sumHidden", table[2]([1, 2, 3]), table[2]([]), table[2](new Array(4, 5)), table[2]([0.5]), table[2](Array.of(6)));
console.log("before", "findAsCallback", table[4]("abc"), table[4]("b"), table[4](""), table[4]("xyz"), table[4](`a${"b"}`));
for (let i = 0; i < 2000; i++) table[5]("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => table[3](make()));
  attempt("findAsCallback " + name, () => [make()].map(table[4])[0]);
  attempt("findHidden " + name, () => new Function("table", "value", "return table[5](value)")(table, make()));
}
console.log("after", "findPlainly", table[3]("abc"), table[3]("b"), table[3](""), table[3]("xyz"), table[3](`a${"b"}`));
console.log("after", "findAsCallback", table[4]("abc"), table[4]("b"), table[4](""), table[4]("xyz"), table[4](`a${"b"}`));
console.log("after", "findHidden", table[5]("abc"), table[5]("b"), table[5](""), table[5]("xyz"), table[5](`a${"b"}`));
console.log("before", "doubleAsCallback", table[7](1), table[7](2.5), table[7](-3), table[7](0), table[7](1e10));
for (let i = 0; i < 2000; i++) table[8](1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => table[6](make()));
  attempt("doubleAsCallback " + name, () => [make()].map(table[7])[0]);
  attempt("doubleHidden " + name, () => new Function("table", "value", "return table[8](value)")(table, make()));
}
console.log("after", "doublePlainly", table[6](1), table[6](2.5), table[6](-3), table[6](0), table[6](1e10));
console.log("after", "doubleAsCallback", table[7](1), table[7](2.5), table[7](-3), table[7](0), table[7](1e10));
console.log("after", "doubleHidden", table[8](1), table[8](2.5), table[8](-3), table[8](0), table[8](1e10));
console.log("before", "spanAsCallback", table[10]({ x: 3, y: 1 }), table[10](new Point(5, 2)), table[10]({ x: 0.5, y: 0.25 }), table[10]({ x: -1, y: -1 }), table[10](new Point(0, 0)));
for (let i = 0; i < 2000; i++) table[11]({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => table[9](make()));
  attempt("spanAsCallback " + name, () => [make()].map(table[10])[0]);
  attempt("spanHidden " + name, () => new Function("table", "value", "return table[11](value)")(table, make()));
}
console.log("after", "spanPlainly", table[9]({ x: 3, y: 1 }), table[9](new Point(5, 2)), table[9]({ x: 0.5, y: 0.25 }), table[9]({ x: -1, y: -1 }), table[9](new Point(0, 0)));
console.log("after", "spanAsCallback", table[10]({ x: 3, y: 1 }), table[10](new Point(5, 2)), table[10]({ x: 0.5, y: 0.25 }), table[10]({ x: -1, y: -1 }), table[10](new Point(0, 0)));
console.log("after", "spanHidden", table[11]({ x: 3, y: 1 }), table[11](new Point(5, 2)), table[11]({ x: 0.5, y: 0.25 }), table[11]({ x: -1, y: -1 }), table[11](new Point(0, 0)));
