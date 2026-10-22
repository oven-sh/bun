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

class Tools {
  static sumPlainly(list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  }

  static sumAsCallback(list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  }

  static sumHidden(list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  }

  static findPlainly(text) {
    return text.indexOf("b");
  }

  static findAsCallback(text) {
    return text.indexOf("b");
  }

  static findHidden(text) {
    return text.indexOf("b");
  }

  static doublePlainly(n) {
    return n * 2;
  }

  static doubleAsCallback(n) {
    return n * 2;
  }

  static doubleHidden(n) {
    return n * 2;
  }

  static spanPlainly(point) {
    const { x, y } = point;
    return x - y;
  }

  static spanAsCallback(point) {
    const { x, y } = point;
    return x - y;
  }

  static spanHidden(point) {
    const { x, y } = point;
    return x - y;
  }
}

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", Tools.sumAsCallback([1, 2, 3]), Tools.sumAsCallback([]), Tools.sumAsCallback(new Array(4, 5)), Tools.sumAsCallback([0.5]), Tools.sumAsCallback(Array.of(6)));
for (let i = 0; i < 2000; i++) Tools.sumHidden([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => Tools.sumPlainly(make()));
  attempt("sumAsCallback " + name, () => [make()].map(Tools.sumAsCallback)[0]);
  attempt("sumHidden " + name, () => new Function("object", "value", "return object.sumHidden(value)")(Tools, make()));
}
console.log("after", "sumPlainly", Tools.sumPlainly([1, 2, 3]), Tools.sumPlainly([]), Tools.sumPlainly(new Array(4, 5)), Tools.sumPlainly([0.5]), Tools.sumPlainly(Array.of(6)));
console.log("after", "sumAsCallback", Tools.sumAsCallback([1, 2, 3]), Tools.sumAsCallback([]), Tools.sumAsCallback(new Array(4, 5)), Tools.sumAsCallback([0.5]), Tools.sumAsCallback(Array.of(6)));
console.log("after", "sumHidden", Tools.sumHidden([1, 2, 3]), Tools.sumHidden([]), Tools.sumHidden(new Array(4, 5)), Tools.sumHidden([0.5]), Tools.sumHidden(Array.of(6)));
console.log("before", "findAsCallback", Tools.findAsCallback("abc"), Tools.findAsCallback("b"), Tools.findAsCallback(""), Tools.findAsCallback("xyz"), Tools.findAsCallback(`a${"b"}`));
for (let i = 0; i < 2000; i++) Tools.findHidden("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => Tools.findPlainly(make()));
  attempt("findAsCallback " + name, () => [make()].map(Tools.findAsCallback)[0]);
  attempt("findHidden " + name, () => new Function("object", "value", "return object.findHidden(value)")(Tools, make()));
}
console.log("after", "findPlainly", Tools.findPlainly("abc"), Tools.findPlainly("b"), Tools.findPlainly(""), Tools.findPlainly("xyz"), Tools.findPlainly(`a${"b"}`));
console.log("after", "findAsCallback", Tools.findAsCallback("abc"), Tools.findAsCallback("b"), Tools.findAsCallback(""), Tools.findAsCallback("xyz"), Tools.findAsCallback(`a${"b"}`));
console.log("after", "findHidden", Tools.findHidden("abc"), Tools.findHidden("b"), Tools.findHidden(""), Tools.findHidden("xyz"), Tools.findHidden(`a${"b"}`));
console.log("before", "doubleAsCallback", Tools.doubleAsCallback(1), Tools.doubleAsCallback(2.5), Tools.doubleAsCallback(-3), Tools.doubleAsCallback(0), Tools.doubleAsCallback(1e10));
for (let i = 0; i < 2000; i++) Tools.doubleHidden(1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => Tools.doublePlainly(make()));
  attempt("doubleAsCallback " + name, () => [make()].map(Tools.doubleAsCallback)[0]);
  attempt("doubleHidden " + name, () => new Function("object", "value", "return object.doubleHidden(value)")(Tools, make()));
}
console.log("after", "doublePlainly", Tools.doublePlainly(1), Tools.doublePlainly(2.5), Tools.doublePlainly(-3), Tools.doublePlainly(0), Tools.doublePlainly(1e10));
console.log("after", "doubleAsCallback", Tools.doubleAsCallback(1), Tools.doubleAsCallback(2.5), Tools.doubleAsCallback(-3), Tools.doubleAsCallback(0), Tools.doubleAsCallback(1e10));
console.log("after", "doubleHidden", Tools.doubleHidden(1), Tools.doubleHidden(2.5), Tools.doubleHidden(-3), Tools.doubleHidden(0), Tools.doubleHidden(1e10));
console.log("before", "spanAsCallback", Tools.spanAsCallback({ x: 3, y: 1 }), Tools.spanAsCallback(new Point(5, 2)), Tools.spanAsCallback({ x: 0.5, y: 0.25 }), Tools.spanAsCallback({ x: -1, y: -1 }), Tools.spanAsCallback(new Point(0, 0)));
for (let i = 0; i < 2000; i++) Tools.spanHidden({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => Tools.spanPlainly(make()));
  attempt("spanAsCallback " + name, () => [make()].map(Tools.spanAsCallback)[0]);
  attempt("spanHidden " + name, () => new Function("object", "value", "return object.spanHidden(value)")(Tools, make()));
}
console.log("after", "spanPlainly", Tools.spanPlainly({ x: 3, y: 1 }), Tools.spanPlainly(new Point(5, 2)), Tools.spanPlainly({ x: 0.5, y: 0.25 }), Tools.spanPlainly({ x: -1, y: -1 }), Tools.spanPlainly(new Point(0, 0)));
console.log("after", "spanAsCallback", Tools.spanAsCallback({ x: 3, y: 1 }), Tools.spanAsCallback(new Point(5, 2)), Tools.spanAsCallback({ x: 0.5, y: 0.25 }), Tools.spanAsCallback({ x: -1, y: -1 }), Tools.spanAsCallback(new Point(0, 0)));
console.log("after", "spanHidden", Tools.spanHidden({ x: 3, y: 1 }), Tools.spanHidden(new Point(5, 2)), Tools.spanHidden({ x: 0.5, y: 0.25 }), Tools.spanHidden({ x: -1, y: -1 }), Tools.spanHidden(new Point(0, 0)));
