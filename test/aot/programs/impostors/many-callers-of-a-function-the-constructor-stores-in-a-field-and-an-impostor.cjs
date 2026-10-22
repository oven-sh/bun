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

function Tools() {
  this.sumPlainly = function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  };

  this.sumAsCallback = function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  };

  this.sumHidden = function (list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  };

  this.findPlainly = function (text) {
    return text.indexOf("b");
  };

  this.findAsCallback = function (text) {
    return text.indexOf("b");
  };

  this.findHidden = function (text) {
    return text.indexOf("b");
  };

  this.doublePlainly = function (n) {
    return n * 2;
  };

  this.doubleAsCallback = function (n) {
    return n * 2;
  };

  this.doubleHidden = function (n) {
    return n * 2;
  };

  this.spanPlainly = function (point) {
    const { x, y } = point;
    return x - y;
  };

  this.spanAsCallback = function (point) {
    const { x, y } = point;
    return x - y;
  };

  this.spanHidden = function (point) {
    const { x, y } = point;
    return x - y;
  };
}

var tools = new Tools();

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", tools.sumAsCallback([1, 2, 3]), tools.sumAsCallback([]), tools.sumAsCallback(new Array(4, 5)), tools.sumAsCallback([0.5]), tools.sumAsCallback(Array.of(6)));
for (let i = 0; i < 2000; i++) tools.sumHidden([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => tools.sumPlainly(make()));
  attempt("sumAsCallback " + name, () => [make()].map(tools.sumAsCallback)[0]);
  attempt("sumHidden " + name, () => new Function("object", "value", "return object.sumHidden(value)")(tools, make()));
}
console.log("after", "sumPlainly", tools.sumPlainly([1, 2, 3]), tools.sumPlainly([]), tools.sumPlainly(new Array(4, 5)), tools.sumPlainly([0.5]), tools.sumPlainly(Array.of(6)));
console.log("after", "sumAsCallback", tools.sumAsCallback([1, 2, 3]), tools.sumAsCallback([]), tools.sumAsCallback(new Array(4, 5)), tools.sumAsCallback([0.5]), tools.sumAsCallback(Array.of(6)));
console.log("after", "sumHidden", tools.sumHidden([1, 2, 3]), tools.sumHidden([]), tools.sumHidden(new Array(4, 5)), tools.sumHidden([0.5]), tools.sumHidden(Array.of(6)));
console.log("before", "findAsCallback", tools.findAsCallback("abc"), tools.findAsCallback("b"), tools.findAsCallback(""), tools.findAsCallback("xyz"), tools.findAsCallback(`a${"b"}`));
for (let i = 0; i < 2000; i++) tools.findHidden("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => tools.findPlainly(make()));
  attempt("findAsCallback " + name, () => [make()].map(tools.findAsCallback)[0]);
  attempt("findHidden " + name, () => new Function("object", "value", "return object.findHidden(value)")(tools, make()));
}
console.log("after", "findPlainly", tools.findPlainly("abc"), tools.findPlainly("b"), tools.findPlainly(""), tools.findPlainly("xyz"), tools.findPlainly(`a${"b"}`));
console.log("after", "findAsCallback", tools.findAsCallback("abc"), tools.findAsCallback("b"), tools.findAsCallback(""), tools.findAsCallback("xyz"), tools.findAsCallback(`a${"b"}`));
console.log("after", "findHidden", tools.findHidden("abc"), tools.findHidden("b"), tools.findHidden(""), tools.findHidden("xyz"), tools.findHidden(`a${"b"}`));
console.log("before", "doubleAsCallback", tools.doubleAsCallback(1), tools.doubleAsCallback(2.5), tools.doubleAsCallback(-3), tools.doubleAsCallback(0), tools.doubleAsCallback(1e10));
for (let i = 0; i < 2000; i++) tools.doubleHidden(1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => tools.doublePlainly(make()));
  attempt("doubleAsCallback " + name, () => [make()].map(tools.doubleAsCallback)[0]);
  attempt("doubleHidden " + name, () => new Function("object", "value", "return object.doubleHidden(value)")(tools, make()));
}
console.log("after", "doublePlainly", tools.doublePlainly(1), tools.doublePlainly(2.5), tools.doublePlainly(-3), tools.doublePlainly(0), tools.doublePlainly(1e10));
console.log("after", "doubleAsCallback", tools.doubleAsCallback(1), tools.doubleAsCallback(2.5), tools.doubleAsCallback(-3), tools.doubleAsCallback(0), tools.doubleAsCallback(1e10));
console.log("after", "doubleHidden", tools.doubleHidden(1), tools.doubleHidden(2.5), tools.doubleHidden(-3), tools.doubleHidden(0), tools.doubleHidden(1e10));
console.log("before", "spanAsCallback", tools.spanAsCallback({ x: 3, y: 1 }), tools.spanAsCallback(new Point(5, 2)), tools.spanAsCallback({ x: 0.5, y: 0.25 }), tools.spanAsCallback({ x: -1, y: -1 }), tools.spanAsCallback(new Point(0, 0)));
for (let i = 0; i < 2000; i++) tools.spanHidden({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => tools.spanPlainly(make()));
  attempt("spanAsCallback " + name, () => [make()].map(tools.spanAsCallback)[0]);
  attempt("spanHidden " + name, () => new Function("object", "value", "return object.spanHidden(value)")(tools, make()));
}
console.log("after", "spanPlainly", tools.spanPlainly({ x: 3, y: 1 }), tools.spanPlainly(new Point(5, 2)), tools.spanPlainly({ x: 0.5, y: 0.25 }), tools.spanPlainly({ x: -1, y: -1 }), tools.spanPlainly(new Point(0, 0)));
console.log("after", "spanAsCallback", tools.spanAsCallback({ x: 3, y: 1 }), tools.spanAsCallback(new Point(5, 2)), tools.spanAsCallback({ x: 0.5, y: 0.25 }), tools.spanAsCallback({ x: -1, y: -1 }), tools.spanAsCallback(new Point(0, 0)));
console.log("after", "spanHidden", tools.spanHidden({ x: 3, y: 1 }), tools.spanHidden(new Point(5, 2)), tools.spanHidden({ x: 0.5, y: 0.25 }), tools.spanHidden({ x: -1, y: -1 }), tools.spanHidden(new Point(0, 0)));
