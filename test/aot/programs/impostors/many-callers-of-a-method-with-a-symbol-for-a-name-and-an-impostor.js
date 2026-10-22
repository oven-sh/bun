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

const names = {};
const tools = {};

names.sumPlainly = Symbol("sumPlainly");
tools[names.sumPlainly] = function (list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
};

names.sumAsCallback = Symbol("sumAsCallback");
tools[names.sumAsCallback] = function (list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
};

names.sumHidden = Symbol("sumHidden");
tools[names.sumHidden] = function (list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
};

names.findPlainly = Symbol("findPlainly");
tools[names.findPlainly] = function (text) {
  return text.indexOf("b");
};

names.findAsCallback = Symbol("findAsCallback");
tools[names.findAsCallback] = function (text) {
  return text.indexOf("b");
};

names.findHidden = Symbol("findHidden");
tools[names.findHidden] = function (text) {
  return text.indexOf("b");
};

names.doublePlainly = Symbol("doublePlainly");
tools[names.doublePlainly] = function (n) {
  return n * 2;
};

names.doubleAsCallback = Symbol("doubleAsCallback");
tools[names.doubleAsCallback] = function (n) {
  return n * 2;
};

names.doubleHidden = Symbol("doubleHidden");
tools[names.doubleHidden] = function (n) {
  return n * 2;
};

names.spanPlainly = Symbol("spanPlainly");
tools[names.spanPlainly] = function (point) {
  const { x, y } = point;
  return x - y;
};

names.spanAsCallback = Symbol("spanAsCallback");
tools[names.spanAsCallback] = function (point) {
  const { x, y } = point;
  return x - y;
};

names.spanHidden = Symbol("spanHidden");
tools[names.spanHidden] = function (point) {
  const { x, y } = point;
  return x - y;
};

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", tools[names.sumAsCallback]([1, 2, 3]), tools[names.sumAsCallback]([]), tools[names.sumAsCallback](new Array(4, 5)), tools[names.sumAsCallback]([0.5]), tools[names.sumAsCallback](Array.of(6)));
for (let i = 0; i < 2000; i++) tools[names.sumHidden]([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => tools[names.sumPlainly](make()));
  attempt("sumAsCallback " + name, () => [make()].map(tools[names.sumAsCallback])[0]);
  attempt("sumHidden " + name, () => new Function("object", "name", "value", "return object[name](value)")(tools, names.sumHidden, make()));
}
console.log("after", "sumPlainly", tools[names.sumPlainly]([1, 2, 3]), tools[names.sumPlainly]([]), tools[names.sumPlainly](new Array(4, 5)), tools[names.sumPlainly]([0.5]), tools[names.sumPlainly](Array.of(6)));
console.log("after", "sumAsCallback", tools[names.sumAsCallback]([1, 2, 3]), tools[names.sumAsCallback]([]), tools[names.sumAsCallback](new Array(4, 5)), tools[names.sumAsCallback]([0.5]), tools[names.sumAsCallback](Array.of(6)));
console.log("after", "sumHidden", tools[names.sumHidden]([1, 2, 3]), tools[names.sumHidden]([]), tools[names.sumHidden](new Array(4, 5)), tools[names.sumHidden]([0.5]), tools[names.sumHidden](Array.of(6)));
console.log("before", "findAsCallback", tools[names.findAsCallback]("abc"), tools[names.findAsCallback]("b"), tools[names.findAsCallback](""), tools[names.findAsCallback]("xyz"), tools[names.findAsCallback](`a${"b"}`));
for (let i = 0; i < 2000; i++) tools[names.findHidden]("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => tools[names.findPlainly](make()));
  attempt("findAsCallback " + name, () => [make()].map(tools[names.findAsCallback])[0]);
  attempt("findHidden " + name, () => new Function("object", "name", "value", "return object[name](value)")(tools, names.findHidden, make()));
}
console.log("after", "findPlainly", tools[names.findPlainly]("abc"), tools[names.findPlainly]("b"), tools[names.findPlainly](""), tools[names.findPlainly]("xyz"), tools[names.findPlainly](`a${"b"}`));
console.log("after", "findAsCallback", tools[names.findAsCallback]("abc"), tools[names.findAsCallback]("b"), tools[names.findAsCallback](""), tools[names.findAsCallback]("xyz"), tools[names.findAsCallback](`a${"b"}`));
console.log("after", "findHidden", tools[names.findHidden]("abc"), tools[names.findHidden]("b"), tools[names.findHidden](""), tools[names.findHidden]("xyz"), tools[names.findHidden](`a${"b"}`));
console.log("before", "doubleAsCallback", tools[names.doubleAsCallback](1), tools[names.doubleAsCallback](2.5), tools[names.doubleAsCallback](-3), tools[names.doubleAsCallback](0), tools[names.doubleAsCallback](1e10));
for (let i = 0; i < 2000; i++) tools[names.doubleHidden](1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => tools[names.doublePlainly](make()));
  attempt("doubleAsCallback " + name, () => [make()].map(tools[names.doubleAsCallback])[0]);
  attempt("doubleHidden " + name, () => new Function("object", "name", "value", "return object[name](value)")(tools, names.doubleHidden, make()));
}
console.log("after", "doublePlainly", tools[names.doublePlainly](1), tools[names.doublePlainly](2.5), tools[names.doublePlainly](-3), tools[names.doublePlainly](0), tools[names.doublePlainly](1e10));
console.log("after", "doubleAsCallback", tools[names.doubleAsCallback](1), tools[names.doubleAsCallback](2.5), tools[names.doubleAsCallback](-3), tools[names.doubleAsCallback](0), tools[names.doubleAsCallback](1e10));
console.log("after", "doubleHidden", tools[names.doubleHidden](1), tools[names.doubleHidden](2.5), tools[names.doubleHidden](-3), tools[names.doubleHidden](0), tools[names.doubleHidden](1e10));
console.log("before", "spanAsCallback", tools[names.spanAsCallback]({ x: 3, y: 1 }), tools[names.spanAsCallback](new Point(5, 2)), tools[names.spanAsCallback]({ x: 0.5, y: 0.25 }), tools[names.spanAsCallback]({ x: -1, y: -1 }), tools[names.spanAsCallback](new Point(0, 0)));
for (let i = 0; i < 2000; i++) tools[names.spanHidden]({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => tools[names.spanPlainly](make()));
  attempt("spanAsCallback " + name, () => [make()].map(tools[names.spanAsCallback])[0]);
  attempt("spanHidden " + name, () => new Function("object", "name", "value", "return object[name](value)")(tools, names.spanHidden, make()));
}
console.log("after", "spanPlainly", tools[names.spanPlainly]({ x: 3, y: 1 }), tools[names.spanPlainly](new Point(5, 2)), tools[names.spanPlainly]({ x: 0.5, y: 0.25 }), tools[names.spanPlainly]({ x: -1, y: -1 }), tools[names.spanPlainly](new Point(0, 0)));
console.log("after", "spanAsCallback", tools[names.spanAsCallback]({ x: 3, y: 1 }), tools[names.spanAsCallback](new Point(5, 2)), tools[names.spanAsCallback]({ x: 0.5, y: 0.25 }), tools[names.spanAsCallback]({ x: -1, y: -1 }), tools[names.spanAsCallback](new Point(0, 0)));
console.log("after", "spanHidden", tools[names.spanHidden]({ x: 3, y: 1 }), tools[names.spanHidden](new Point(5, 2)), tools[names.spanHidden]({ x: 0.5, y: 0.25 }), tools[names.spanHidden]({ x: -1, y: -1 }), tools[names.spanHidden](new Point(0, 0)));
