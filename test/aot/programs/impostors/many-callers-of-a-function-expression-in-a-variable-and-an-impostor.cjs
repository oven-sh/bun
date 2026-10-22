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

var sumPlainly = function (list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
};

var sumAsCallback = function (list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
};

var sumHidden = function (list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
};

var findPlainly = function (text) {
  return text.indexOf("b");
};

var findAsCallback = function (text) {
  return text.indexOf("b");
};

var findHidden = function (text) {
  return text.indexOf("b");
};

var doublePlainly = function (n) {
  return n * 2;
};

var doubleAsCallback = function (n) {
  return n * 2;
};

var doubleHidden = function (n) {
  return n * 2;
};

var spanPlainly = function (point) {
  const { x, y } = point;
  return x - y;
};

var spanAsCallback = function (point) {
  const { x, y } = point;
  return x - y;
};

var spanHidden = function (point) {
  const { x, y } = point;
  return x - y;
};

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", sumAsCallback([1, 2, 3]), sumAsCallback([]), sumAsCallback(new Array(4, 5)), sumAsCallback([0.5]), sumAsCallback(Array.of(6)));
for (let i = 0; i < 2000; i++) sumHidden([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => sumPlainly(make()));
  attempt("sumAsCallback " + name, () => [make()].map(sumAsCallback)[0]);
  attempt("sumHidden " + name, () => new Function("f", "value", "return f(value)")(sumHidden, make()));
}
console.log("after", "sumPlainly", sumPlainly([1, 2, 3]), sumPlainly([]), sumPlainly(new Array(4, 5)), sumPlainly([0.5]), sumPlainly(Array.of(6)));
console.log("after", "sumAsCallback", sumAsCallback([1, 2, 3]), sumAsCallback([]), sumAsCallback(new Array(4, 5)), sumAsCallback([0.5]), sumAsCallback(Array.of(6)));
console.log("after", "sumHidden", sumHidden([1, 2, 3]), sumHidden([]), sumHidden(new Array(4, 5)), sumHidden([0.5]), sumHidden(Array.of(6)));
console.log("before", "findAsCallback", findAsCallback("abc"), findAsCallback("b"), findAsCallback(""), findAsCallback("xyz"), findAsCallback(`a${"b"}`));
for (let i = 0; i < 2000; i++) findHidden("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => findPlainly(make()));
  attempt("findAsCallback " + name, () => [make()].map(findAsCallback)[0]);
  attempt("findHidden " + name, () => new Function("f", "value", "return f(value)")(findHidden, make()));
}
console.log("after", "findPlainly", findPlainly("abc"), findPlainly("b"), findPlainly(""), findPlainly("xyz"), findPlainly(`a${"b"}`));
console.log("after", "findAsCallback", findAsCallback("abc"), findAsCallback("b"), findAsCallback(""), findAsCallback("xyz"), findAsCallback(`a${"b"}`));
console.log("after", "findHidden", findHidden("abc"), findHidden("b"), findHidden(""), findHidden("xyz"), findHidden(`a${"b"}`));
console.log("before", "doubleAsCallback", doubleAsCallback(1), doubleAsCallback(2.5), doubleAsCallback(-3), doubleAsCallback(0), doubleAsCallback(1e10));
for (let i = 0; i < 2000; i++) doubleHidden(1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => doublePlainly(make()));
  attempt("doubleAsCallback " + name, () => [make()].map(doubleAsCallback)[0]);
  attempt("doubleHidden " + name, () => new Function("f", "value", "return f(value)")(doubleHidden, make()));
}
console.log("after", "doublePlainly", doublePlainly(1), doublePlainly(2.5), doublePlainly(-3), doublePlainly(0), doublePlainly(1e10));
console.log("after", "doubleAsCallback", doubleAsCallback(1), doubleAsCallback(2.5), doubleAsCallback(-3), doubleAsCallback(0), doubleAsCallback(1e10));
console.log("after", "doubleHidden", doubleHidden(1), doubleHidden(2.5), doubleHidden(-3), doubleHidden(0), doubleHidden(1e10));
console.log("before", "spanAsCallback", spanAsCallback({ x: 3, y: 1 }), spanAsCallback(new Point(5, 2)), spanAsCallback({ x: 0.5, y: 0.25 }), spanAsCallback({ x: -1, y: -1 }), spanAsCallback(new Point(0, 0)));
for (let i = 0; i < 2000; i++) spanHidden({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => spanPlainly(make()));
  attempt("spanAsCallback " + name, () => [make()].map(spanAsCallback)[0]);
  attempt("spanHidden " + name, () => new Function("f", "value", "return f(value)")(spanHidden, make()));
}
console.log("after", "spanPlainly", spanPlainly({ x: 3, y: 1 }), spanPlainly(new Point(5, 2)), spanPlainly({ x: 0.5, y: 0.25 }), spanPlainly({ x: -1, y: -1 }), spanPlainly(new Point(0, 0)));
console.log("after", "spanAsCallback", spanAsCallback({ x: 3, y: 1 }), spanAsCallback(new Point(5, 2)), spanAsCallback({ x: 0.5, y: 0.25 }), spanAsCallback({ x: -1, y: -1 }), spanAsCallback(new Point(0, 0)));
console.log("after", "spanHidden", spanHidden({ x: 3, y: 1 }), spanHidden(new Point(5, 2)), spanHidden({ x: 0.5, y: 0.25 }), spanHidden({ x: -1, y: -1 }), spanHidden(new Point(0, 0)));
