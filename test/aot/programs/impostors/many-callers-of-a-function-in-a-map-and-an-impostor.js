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

const table = new Map([
  ["sumPlainly", function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  }],

  ["sumAsCallback", function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  }],

  ["sumHidden", function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  }],

  ["findPlainly", function (text) {
    return text.indexOf("b");
  }],

  ["findAsCallback", function (text) {
    return text.indexOf("b");
  }],

  ["findHidden", function (text) {
    return text.indexOf("b");
  }],

  ["doublePlainly", function (n) {
    return n * 2;
  }],

  ["doubleAsCallback", function (n) {
    return n * 2;
  }],

  ["doubleHidden", function (n) {
    return n * 2;
  }],

  ["spanPlainly", function (point) {
    const { x, y } = point;
    return x - y;
  }],

  ["spanAsCallback", function (point) {
    const { x, y } = point;
    return x - y;
  }],

  ["spanHidden", function (point) {
    const { x, y } = point;
    return x - y;
  }],
]);

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", table.get("sumAsCallback")([1, 2, 3]), table.get("sumAsCallback")([]), table.get("sumAsCallback")(new Array(4, 5)), table.get("sumAsCallback")([0.5]), table.get("sumAsCallback")(Array.of(6)));
for (let i = 0; i < 2000; i++) table.get("sumHidden")([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => table.get("sumPlainly")(make()));
  attempt("sumAsCallback " + name, () => [make()].map(table.get("sumAsCallback"))[0]);
  attempt("sumHidden " + name, () => new Function("table", "value", "return table.get('sumHidden')(value)")(table, make()));
}
console.log("after", "sumPlainly", table.get("sumPlainly")([1, 2, 3]), table.get("sumPlainly")([]), table.get("sumPlainly")(new Array(4, 5)), table.get("sumPlainly")([0.5]), table.get("sumPlainly")(Array.of(6)));
console.log("after", "sumAsCallback", table.get("sumAsCallback")([1, 2, 3]), table.get("sumAsCallback")([]), table.get("sumAsCallback")(new Array(4, 5)), table.get("sumAsCallback")([0.5]), table.get("sumAsCallback")(Array.of(6)));
console.log("after", "sumHidden", table.get("sumHidden")([1, 2, 3]), table.get("sumHidden")([]), table.get("sumHidden")(new Array(4, 5)), table.get("sumHidden")([0.5]), table.get("sumHidden")(Array.of(6)));
console.log("before", "findAsCallback", table.get("findAsCallback")("abc"), table.get("findAsCallback")("b"), table.get("findAsCallback")(""), table.get("findAsCallback")("xyz"), table.get("findAsCallback")(`a${"b"}`));
for (let i = 0; i < 2000; i++) table.get("findHidden")("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => table.get("findPlainly")(make()));
  attempt("findAsCallback " + name, () => [make()].map(table.get("findAsCallback"))[0]);
  attempt("findHidden " + name, () => new Function("table", "value", "return table.get('findHidden')(value)")(table, make()));
}
console.log("after", "findPlainly", table.get("findPlainly")("abc"), table.get("findPlainly")("b"), table.get("findPlainly")(""), table.get("findPlainly")("xyz"), table.get("findPlainly")(`a${"b"}`));
console.log("after", "findAsCallback", table.get("findAsCallback")("abc"), table.get("findAsCallback")("b"), table.get("findAsCallback")(""), table.get("findAsCallback")("xyz"), table.get("findAsCallback")(`a${"b"}`));
console.log("after", "findHidden", table.get("findHidden")("abc"), table.get("findHidden")("b"), table.get("findHidden")(""), table.get("findHidden")("xyz"), table.get("findHidden")(`a${"b"}`));
console.log("before", "doubleAsCallback", table.get("doubleAsCallback")(1), table.get("doubleAsCallback")(2.5), table.get("doubleAsCallback")(-3), table.get("doubleAsCallback")(0), table.get("doubleAsCallback")(1e10));
for (let i = 0; i < 2000; i++) table.get("doubleHidden")(1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => table.get("doublePlainly")(make()));
  attempt("doubleAsCallback " + name, () => [make()].map(table.get("doubleAsCallback"))[0]);
  attempt("doubleHidden " + name, () => new Function("table", "value", "return table.get('doubleHidden')(value)")(table, make()));
}
console.log("after", "doublePlainly", table.get("doublePlainly")(1), table.get("doublePlainly")(2.5), table.get("doublePlainly")(-3), table.get("doublePlainly")(0), table.get("doublePlainly")(1e10));
console.log("after", "doubleAsCallback", table.get("doubleAsCallback")(1), table.get("doubleAsCallback")(2.5), table.get("doubleAsCallback")(-3), table.get("doubleAsCallback")(0), table.get("doubleAsCallback")(1e10));
console.log("after", "doubleHidden", table.get("doubleHidden")(1), table.get("doubleHidden")(2.5), table.get("doubleHidden")(-3), table.get("doubleHidden")(0), table.get("doubleHidden")(1e10));
console.log("before", "spanAsCallback", table.get("spanAsCallback")({ x: 3, y: 1 }), table.get("spanAsCallback")(new Point(5, 2)), table.get("spanAsCallback")({ x: 0.5, y: 0.25 }), table.get("spanAsCallback")({ x: -1, y: -1 }), table.get("spanAsCallback")(new Point(0, 0)));
for (let i = 0; i < 2000; i++) table.get("spanHidden")({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => table.get("spanPlainly")(make()));
  attempt("spanAsCallback " + name, () => [make()].map(table.get("spanAsCallback"))[0]);
  attempt("spanHidden " + name, () => new Function("table", "value", "return table.get('spanHidden')(value)")(table, make()));
}
console.log("after", "spanPlainly", table.get("spanPlainly")({ x: 3, y: 1 }), table.get("spanPlainly")(new Point(5, 2)), table.get("spanPlainly")({ x: 0.5, y: 0.25 }), table.get("spanPlainly")({ x: -1, y: -1 }), table.get("spanPlainly")(new Point(0, 0)));
console.log("after", "spanAsCallback", table.get("spanAsCallback")({ x: 3, y: 1 }), table.get("spanAsCallback")(new Point(5, 2)), table.get("spanAsCallback")({ x: 0.5, y: 0.25 }), table.get("spanAsCallback")({ x: -1, y: -1 }), table.get("spanAsCallback")(new Point(0, 0)));
console.log("after", "spanHidden", table.get("spanHidden")({ x: 3, y: 1 }), table.get("spanHidden")(new Point(5, 2)), table.get("spanHidden")({ x: 0.5, y: 0.25 }), table.get("spanHidden")({ x: -1, y: -1 }), table.get("spanHidden")(new Point(0, 0)));
