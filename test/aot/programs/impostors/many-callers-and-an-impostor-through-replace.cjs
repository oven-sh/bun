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

function honestFirst(round) {
  console.log(round, "half", half(4), half(3), half(0.5), half(-8), half(1e21), half(0));
  console.log(round, "low", low(1), low(256), low(-1), low(1023), low(0), low(65535));
  console.log(round, "invoke", invoke(v => v + 1), invoke(function (v) { return v * 2; }), invoke(v => -v), invoke(v => [v].length), invoke(function same(v) { return v; }), invoke(() => 0));
  console.log(round, "sumOf", sumOf({ x: 1, y: 2 }), sumOf({ x: 3, y: 4 }), sumOf(new Point(5, 6)), sumOf({ x: 0.5, y: 0.5 }), sumOf(new Point(-1, 1)), sumOf({ x: 7, y: 8 }));
  console.log(round, "total", total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), total(Array.of(7, 8)), total([1, 2, 3, 4].slice(1)));
  console.log(round, "firstCode", firstCode("a"), firstCode("bc"), firstCode(""), firstCode("\u00e9"), firstCode(`t${round}`), firstCode(String(12)));
}

function honestSecond(round) {
  console.log(round, "below", below(0), below(1), below(2.5), below(3), below(-1), below(10));
  console.log(round, "pick", pick(0), pick(1), pick(2), pick(3), pick(1 + 1), pick(letters.length - 1));
  console.log(round, "build", build(class { constructor(v) { this.value = v; } }), build(function (v) { this.value = v * 2; }), build(class { value = 3; }), build(function () {}), build(class extends Point { get value() { return this.x; } }), build(function (v) { return { value: -v }; }));
  console.log(round, "move", move({ x: 1, y: 2 }), move({ x: 3, y: 4 }), move(new Point(5, 6)), move({ x: 0.5, y: 0.5 }), move(new Point(-1, 1)), move({ x: 7, y: 8 }));
  console.log(round, "append", append([1, 2, 3]), append([]), append(new Array(1, 2)), append(["a"]), append([[1], [2]]), append(Array.of(1, 2, 3, 4)));
  console.log(round, "tail", tail("abc"), tail(""), tail("x"), tail(`t${round}`), tail("\u00e9!"), tail(String(123)));
}

console.log("strict:", (function () { return this === undefined; })());
honestSecond("before");
attempt("half gets the match", () => "abc".replace("b", half));
attempt("below gets the match", () => "abc".replace("b", below));
attempt("low gets the match", () => "abc".replace("b", low));
attempt("pick gets the match", () => "abc".replace("b", pick));
attempt("invoke gets the match", () => "abc".replace("b", invoke));
attempt("build gets the match", () => "abc".replace("b", build));
attempt("sumOf gets the match", () => "abc".replace("b", sumOf));
attempt("move gets the match", () => "abc".replace("b", move));
attempt("total gets the match", () => "abc".replace("b", total));
attempt("append gets the match", () => "abc".replace("b", append));
attempt("firstCode gets the match", () => "abc".replace("b", firstCode));
attempt("tail gets the match", () => "abc".replace("b", tail));
honestFirst("after");
honestSecond("after");
