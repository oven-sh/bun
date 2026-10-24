function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function largest(Math) {
  return Math.max(1, 2);
}

function rounded(Math, n) {
  return Math.floor(n);
}

function isList(Array, value) {
  return Array.isArray(value);
}

function madeList(Array) {
  return new Array(3).length;
}

function parsed(parseInt) {
  return parseInt("12px");
}

function keys(Object, value) {
  return Object.keys(value);
}

function text(String, value) {
  return String(value);
}

function number(Number, value) {
  return Number(value);
}

function encoded(JSON, value) {
  return JSON.stringify(value);
}

function applied(Reflect, f) {
  return Reflect.apply(f, null, [1, 2]);
}

function resolved(Promise) {
  return typeof Promise.resolve(1);
}

function evaluated(eval) {
  const hidden = "local";
  return eval("typeof hidden");
}

function printed(console) {
  return console.log("printed through the parameter");
}

function honest(round) {
  console.log(round, largest(Math), rounded(Math, 1.5), isList(Array, []), madeList(Array), parsed(parseInt), show(keys(Object, { a: 1 })), text(String, 1), number(Number, "1"), encoded(JSON, [1]), applied(Reflect, (a, b) => a + b), resolved(Promise), evaluated(eval));
}

honest("before");
attempt("another Math", () => largest({ max: (...list) => "mine " + list.join() }));
attempt("a Math without max", () => largest({}));
attempt("a heir of Math that overrides max", () => largest(Object.create(Math, { max: { value: () => "the heir's" } })));
attempt("a proxy of Math", () => largest(new Proxy(Math, { get: (target, key) => (log.push(String(key)), target[key]) })));
attempt("another floor", () => rounded({ floor: n => "mine " + n }, 1.5));
attempt("undefined for Math", () => largest(undefined));
attempt("another Array", () => [isList({ isArray: () => "mine" }, []), madeList(function (n) { this.length = "mine " + n; })]);
attempt("a subclass for Array", () => [isList(class extends Array { static isArray() { return "the subclass's"; } }, []), madeList(class extends Array {})]);
attempt("another parseInt", () => parsed(value => "mine " + value));
attempt("parseFloat for parseInt", () => parsed(parseFloat));
attempt("another Object", () => keys({ keys: () => "mine" }, { a: 1 }));
attempt("Reflect for Object", () => keys({ keys: Reflect.ownKeys }, [1]));
attempt("another String", () => text(value => "mine " + value, 1));
attempt("Symbol for String", () => typeof text(Symbol, 1));
attempt("another Number", () => number(value => "mine " + value, "1"));
attempt("BigInt for Number", () => number(BigInt, "1"));
attempt("another JSON", () => encoded({ stringify: () => "mine" }, [1]));
attempt("another Reflect", () => applied({ apply: () => "mine" }, () => 0));
attempt("another Promise", () => resolved({ resolve: () => "mine" }));
attempt("another eval", () => evaluated(source => "mine " + source));
attempt("eval under another name is indirect", () => { const other = eval; const hidden = "local"; return other("typeof hidden"); });
attempt("another console", () => printed({ log: value => "mine " + value }));

{
  const Math = { max: () => "a const in a block", PI: "pie" };
  const parseInt = () => "a const in a block";
  const isNaN = () => "a const in a block";
  attempt("names declared in a block", () => [Math.max(1, 2), Math.PI, parseInt("1"), isNaN(1)]);
}
attempt("outside the block", () => [Math.max(1, 2), Math.PI > 3, parseInt("1"), isNaN(1)]);

function hoisted() {
  const before = typeof Math;
  var Math = { max: () => "a var in the function" };
  return [before, Math.max(1, 2)];
}

function declared() {
  return [Array.isArray([]), Array.name];
  function Array() {}
}

function caught() {
  try {
    throw { max: () => "the caught value" };
  } catch (Math) {
    return Math.max(1, 2);
  }
}

function classNamed() {
  class Map {
    get(key) {
      return "a class named Map " + key;
    }
  }
  return new Map().get(1);
}

function destructured({ Math, JSON: { stringify } }) {
  return [Math.max(1, 2), stringify([1])];
}

function looped() {
  const out = [];
  for (const Math of [{ max: () => "first" }, { max: () => "second" }]) out.push(Math.max(1, 2));
  return out;
}

attempt("a var hoisted over Math", hoisted);
attempt("a function declaration named Array", declared);
attempt("a catch parameter named Math", caught);
attempt("a class named Map", classNamed);
attempt("destructured parameters", () => destructured({ Math: { max: () => "destructured" }, JSON: { stringify: () => "destructured" } }));
attempt("a loop variable named Math", looped);
attempt("a default that reads the outer name", () => ((max = Math.max, Math = { max: () => "inner" }) => [max(1, 2), Math.max(1, 2)])());
attempt("methods taken off and called", () => { const { max } = Math; const { isArray } = Array; const { keys } = Object; return [max(1, 2), isArray([]), keys({ a: 1 })]; });
attempt("methods taken off that need their receiver", () => { const { resolve } = Promise; return resolve(1); });
attempt("methods of an array taken off", () => { const { push } = []; return push(1); });
honest("after");
