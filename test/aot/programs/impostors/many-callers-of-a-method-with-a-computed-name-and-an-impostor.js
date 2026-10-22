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

const prefix = ["to", "ol"].join("");

const tools = {
  [prefix + "sumPlainly"](list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  },

  [prefix + "sumAsCallback"](list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  },

  [prefix + "sumHidden"](list) {
    let sum = 0;
    for (const item of list) sum += item;
    return sum;
  },

  [prefix + "findPlainly"](text) {
    return text.indexOf("b");
  },

  [prefix + "findAsCallback"](text) {
    return text.indexOf("b");
  },

  [prefix + "findHidden"](text) {
    return text.indexOf("b");
  },

  [prefix + "doublePlainly"](n) {
    return n * 2;
  },

  [prefix + "doubleAsCallback"](n) {
    return n * 2;
  },

  [prefix + "doubleHidden"](n) {
    return n * 2;
  },

  [prefix + "spanPlainly"](point) {
    const { x, y } = point;
    return x - y;
  },

  [prefix + "spanAsCallback"](point) {
    const { x, y } = point;
    return x - y;
  },

  [prefix + "spanHidden"](point) {
    const { x, y } = point;
    return x - y;
  },
};

console.log("strict:", (function () { return this === undefined; })());
console.log("before", "sumAsCallback", tools.toolsumAsCallback([1, 2, 3]), tools.toolsumAsCallback([]), tools.toolsumAsCallback(new Array(4, 5)), tools.toolsumAsCallback([0.5]), tools.toolsumAsCallback(Array.of(6)));
for (let i = 0; i < 2000; i++) tools.toolsumHidden([1, 2, 3]);
for (const [name, make] of notLists) {
  attempt("sumPlainly " + name, () => tools.toolsumPlainly(make()));
  attempt("sumAsCallback " + name, () => [make()].map(tools.toolsumAsCallback)[0]);
  attempt("sumHidden " + name, () => new Function("object", "value", "return object.toolsumHidden(value)")(tools, make()));
}
console.log("after", "sumPlainly", tools.toolsumPlainly([1, 2, 3]), tools.toolsumPlainly([]), tools.toolsumPlainly(new Array(4, 5)), tools.toolsumPlainly([0.5]), tools.toolsumPlainly(Array.of(6)));
console.log("after", "sumAsCallback", tools.toolsumAsCallback([1, 2, 3]), tools.toolsumAsCallback([]), tools.toolsumAsCallback(new Array(4, 5)), tools.toolsumAsCallback([0.5]), tools.toolsumAsCallback(Array.of(6)));
console.log("after", "sumHidden", tools.toolsumHidden([1, 2, 3]), tools.toolsumHidden([]), tools.toolsumHidden(new Array(4, 5)), tools.toolsumHidden([0.5]), tools.toolsumHidden(Array.of(6)));
console.log("before", "findAsCallback", tools.toolfindAsCallback("abc"), tools.toolfindAsCallback("b"), tools.toolfindAsCallback(""), tools.toolfindAsCallback("xyz"), tools.toolfindAsCallback(`a${"b"}`));
for (let i = 0; i < 2000; i++) tools.toolfindHidden("abc");
for (const [name, make] of notTexts) {
  attempt("findPlainly " + name, () => tools.toolfindPlainly(make()));
  attempt("findAsCallback " + name, () => [make()].map(tools.toolfindAsCallback)[0]);
  attempt("findHidden " + name, () => new Function("object", "value", "return object.toolfindHidden(value)")(tools, make()));
}
console.log("after", "findPlainly", tools.toolfindPlainly("abc"), tools.toolfindPlainly("b"), tools.toolfindPlainly(""), tools.toolfindPlainly("xyz"), tools.toolfindPlainly(`a${"b"}`));
console.log("after", "findAsCallback", tools.toolfindAsCallback("abc"), tools.toolfindAsCallback("b"), tools.toolfindAsCallback(""), tools.toolfindAsCallback("xyz"), tools.toolfindAsCallback(`a${"b"}`));
console.log("after", "findHidden", tools.toolfindHidden("abc"), tools.toolfindHidden("b"), tools.toolfindHidden(""), tools.toolfindHidden("xyz"), tools.toolfindHidden(`a${"b"}`));
console.log("before", "doubleAsCallback", tools.tooldoubleAsCallback(1), tools.tooldoubleAsCallback(2.5), tools.tooldoubleAsCallback(-3), tools.tooldoubleAsCallback(0), tools.tooldoubleAsCallback(1e10));
for (let i = 0; i < 2000; i++) tools.tooldoubleHidden(1);
for (const [name, make] of notNumbers) {
  attempt("doublePlainly " + name, () => tools.tooldoublePlainly(make()));
  attempt("doubleAsCallback " + name, () => [make()].map(tools.tooldoubleAsCallback)[0]);
  attempt("doubleHidden " + name, () => new Function("object", "value", "return object.tooldoubleHidden(value)")(tools, make()));
}
console.log("after", "doublePlainly", tools.tooldoublePlainly(1), tools.tooldoublePlainly(2.5), tools.tooldoublePlainly(-3), tools.tooldoublePlainly(0), tools.tooldoublePlainly(1e10));
console.log("after", "doubleAsCallback", tools.tooldoubleAsCallback(1), tools.tooldoubleAsCallback(2.5), tools.tooldoubleAsCallback(-3), tools.tooldoubleAsCallback(0), tools.tooldoubleAsCallback(1e10));
console.log("after", "doubleHidden", tools.tooldoubleHidden(1), tools.tooldoubleHidden(2.5), tools.tooldoubleHidden(-3), tools.tooldoubleHidden(0), tools.tooldoubleHidden(1e10));
console.log("before", "spanAsCallback", tools.toolspanAsCallback({ x: 3, y: 1 }), tools.toolspanAsCallback(new Point(5, 2)), tools.toolspanAsCallback({ x: 0.5, y: 0.25 }), tools.toolspanAsCallback({ x: -1, y: -1 }), tools.toolspanAsCallback(new Point(0, 0)));
for (let i = 0; i < 2000; i++) tools.toolspanHidden({ x: 3, y: 1 });
for (const [name, make] of notPoints) {
  attempt("spanPlainly " + name, () => tools.toolspanPlainly(make()));
  attempt("spanAsCallback " + name, () => [make()].map(tools.toolspanAsCallback)[0]);
  attempt("spanHidden " + name, () => new Function("object", "value", "return object.toolspanHidden(value)")(tools, make()));
}
console.log("after", "spanPlainly", tools.toolspanPlainly({ x: 3, y: 1 }), tools.toolspanPlainly(new Point(5, 2)), tools.toolspanPlainly({ x: 0.5, y: 0.25 }), tools.toolspanPlainly({ x: -1, y: -1 }), tools.toolspanPlainly(new Point(0, 0)));
console.log("after", "spanAsCallback", tools.toolspanAsCallback({ x: 3, y: 1 }), tools.toolspanAsCallback(new Point(5, 2)), tools.toolspanAsCallback({ x: 0.5, y: 0.25 }), tools.toolspanAsCallback({ x: -1, y: -1 }), tools.toolspanAsCallback(new Point(0, 0)));
console.log("after", "spanHidden", tools.toolspanHidden({ x: 3, y: 1 }), tools.toolspanHidden(new Point(5, 2)), tools.toolspanHidden({ x: 0.5, y: 0.25 }), tools.toolspanHidden({ x: -1, y: -1 }), tools.toolspanHidden(new Point(0, 0)));
