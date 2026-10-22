function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

let last;
const log = [];

function attempt(label, run) {
  last = "never set";
  log.length = 0;
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last) + (log.length ? ", log " + log.join(" ") : ""));
}

class Stack extends Array {
  push() {
    return "the subclass's push";
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function append(list) {
  return (last = list.push(4));
}

function firstCode(text) {
  return (last = text.charCodeAt(0));
}

function tail(text) {
  return (last = text.slice(1));
}

function half(n) {
  return (last = n / 2);
}

function below(n) {
  let steps = 0;
  while (n < 3) {
    n++;
    steps++;
  }
  return (last = steps);
}

const letters = ["a", "b", "c", "d"];

function low(n) {
  return (last = n & 255);
}

function pick(i) {
  return (last = letters[i]);
}

function invoke(f) {
  return (last = f(2));
}

function build(f) {
  return (last = new f(2).value);
}

function sumOf(point) {
  return (last = point.x + point.y);
}

function move(point) {
  point.x = point.x + 1;
  return (last = point.x);
}

const notArrays = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a subclass", () => new Stack(1, 2)],
  ["a frozen array", () => Object.freeze([1, 2])],
  ["an array of holes", () => new Array(2)],
  ["parsed JSON", () => JSON.parse('{"0":5,"length":1}')],
  ["null", () => null],
];

const notStrings = [
  ["an array", () => ["a", "b"]],
  ["a String object", () => new String("ab")],
  ["an object with the methods", () => ({ charCodeAt: () => "a code", slice: () => "a slice" })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a number", () => 65],
  ["undefined", () => undefined],
];

const notNumbers = [
  ["a numeric string", () => "1"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 1) })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: hint => (log.push(hint), 2) })],
  ["a BigInt", () => 1n],
  ["an array of one", () => [1]],
  ["a symbol", () => Symbol("s")],
  ["negative zero", () => -0],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notSmallIntegers = [
  ["two to the 31st", () => 2147483648],
  ["past two to the 32nd", () => 4294967297],
  ["a fraction", () => 1.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["a numeric string", () => "1"],
  ["a name", () => "length"],
  ["an object", () => ({ valueOf: () => (log.push("valueOf"), 2), toString: () => (log.push("toString"), "3") })],
  ["a BigInt", () => 1n],
  ["undefined", () => undefined],
];

const notFunctions = [
  ["a class", () => class { constructor(v) { this.value = v; } }],
  ["an arrow function", () => v => ({ value: v })],
  ["a bound function", () => function (a, b) { this.value = [a, b]; return a + b; }.bind({}, 1)],
  ["a callable proxy", () => new Proxy(function () {}, { apply: (target, self, list) => (log.push("apply"), list[0]), construct: (target, list) => (log.push("construct"), { value: list[0] }) })],
  ["an async function", () => async v => v],
  ["an object with call and apply", () => ({ call: () => "call", apply: () => "apply" })],
  ["a string", () => "f"],
  ["undefined", () => undefined],
];

const notPoints = [
  ["the other key order", () => ({ y: 2, x: 1 })],
  ["a getter", () => ({ get x() { log.push("get x"); return 1; }, y: 2 })],
  ["accessors on the prototype", () => Object.create({ get x() { log.push("get x"); return 1; }, set x(v) { log.push("set x " + v); }, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (target, key) => (log.push("get " + String(key)), target[key]), set: (target, key, v) => (log.push("set " + String(key)), (target[key] = v), true) })],
  ["y is missing", () => ({ x: 1 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["strings inside", () => ({ x: "1", y: "2" })],
  ["parsed JSON", () => JSON.parse('{"y":2,"x":1}')],
  ["a number", () => 5],
  ["null", () => null],
];

function honestFirst(round) {
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\u00e9"), firstCode(`t${round}`), firstCode(String(12)));
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
}

function honestSecond(round) {
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(`t${round}`), tail("\u00e9!"), tail(String(123)));
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
for (const [name, make] of notArrays) {
  attempt("total of " + name, () => new Function("f", "value", "return f(value)")(total, make()));
  attempt("append to " + name, () => new Function("f", "value", "return f(value)")(append, make()));
}
attempt("total of a literal", () => new Function("f", "value", "return f(value)")(total, "12"));
attempt("append to a literal", () => new Function("f", "value", "return f(value)")(append, { push: () => "a literal's push" }));
for (const [name, make] of notStrings) {
  attempt("firstCode of " + name, () => new Function("f", "value", "return f(value)")(firstCode, make()));
  attempt("tail of " + name, () => new Function("f", "value", "return f(value)")(tail, make()));
}
attempt("firstCode of a literal", () => new Function("f", "value", "return f(value)")(firstCode, [65]));
attempt("tail of a literal", () => new Function("f", "value", "return f(value)")(tail, [1, 2, 3]));
for (const [name, make] of notNumbers) {
  attempt("half of " + name, () => new Function("f", "value", "return f(value)")(half, make()));
  attempt("below from " + name, () => new Function("f", "value", "return f(value)")(below, make()));
}
attempt("half of a literal", () => new Function("f", "value", "return f(value)")(half, "4"));
attempt("below from a literal", () => new Function("f", "value", "return f(value)")(below, "1"));
for (const [name, make] of notSmallIntegers) {
  attempt("low of " + name, () => new Function("f", "value", "return f(value)")(low, make()));
  attempt("pick at " + name, () => new Function("f", "value", "return f(value)")(pick, make()));
}
attempt("low of a literal", () => new Function("f", "value", "return f(value)")(low, 4294967297.5));
attempt("pick at a literal", () => new Function("f", "value", "return f(value)")(pick, "length"));
for (const [name, make] of notFunctions) {
  attempt("invoke of " + name, () => new Function("f", "value", "return f(value)")(invoke, make()));
  attempt("build from " + name, () => new Function("f", "value", "return f(value)")(build, make()));
}
attempt("invoke of a literal", () => new Function("f", "value", "return f(value)")(invoke, class {}));
attempt("build from a literal", () => new Function("f", "value", "return f(value)")(build, () => {}));
for (const [name, make] of notPoints) {
  attempt("sumOf " + name, () => new Function("f", "value", "return f(value)")(sumOf, make()));
  attempt("move " + name, () => new Function("f", "value", "return f(value)")(move, make()));
}
attempt("sumOf a literal", () => new Function("f", "value", "return f(value)")(sumOf, { y: 2, x: 1 }));
attempt("move a literal", () => new Function("f", "value", "return f(value)")(move, { get x() { return 1; }, y: 2 }));
honestFirst("after");
honestSecond("after");
