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

function describe(self) {
  if (self === undefined || self === null) return String(self);
  return typeof self + " " + Object.prototype.toString.call(self).slice(8, -1);
}

function who() {
  return describe(this);
}

function same(given) {
  return this === given;
}

function remember() {
  this.note = "kept";
  return this.note;
}

function add(prototype) {
  Object.defineProperty(prototype, "whoAmI", { value: who, configurable: true, writable: true });
  Object.defineProperty(prototype, "sameAs", { value: same, configurable: true, writable: true });
  Object.defineProperty(prototype, "rememberNote", { value: remember, configurable: true, writable: true });
  Object.defineProperty(prototype, "selfGetter", { get: who, configurable: true });
}

function callOn(value) {
  return value.whoAmI();
}

function readOn(value) {
  return value.selfGetter;
}

console.log("strict:", (function () { return this === undefined; })());
const cases = [
  ["Number.prototype", Number.prototype, [5, 0, -0, NaN, 1.5, new Number(5)]],
  ["String.prototype", String.prototype, ["text", "", new String("text")]],
  ["Boolean.prototype", Boolean.prototype, [true, false, new Boolean(false)]],
  ["Symbol.prototype", Symbol.prototype, [Symbol.iterator, Object(Symbol.iterator)]],
  ["BigInt.prototype", BigInt.prototype, [5n, Object(5n)]],
];
for (const [name, prototype, values] of cases) {
  add(prototype);
  for (const value of values) {
    const label = name + " " + (typeof value === "object" ? "a wrapper" : typeof value === "symbol" ? "a symbol" : show(value));
    attempt(label + " value.whoAmI()", () => callOn(value));
    attempt(label + " value.selfGetter", () => readOn(value));
    attempt(label + " value['whoAmI']()", () => value["who" + "AmI"]());
    attempt(label + " value?.whoAmI()", () => value?.whoAmI());
    attempt(label + " value.sameAs(value)", () => value.sameAs(value));
    attempt(label + " value.rememberNote()", () => value.rememberNote());
    attempt(label + " Reflect.get with the value as receiver", () => Reflect.get(prototype, "selfGetter", value));
  }
}
attempt("a literal number", () => [(5).whoAmI(), 5..whoAmI(), 5.5.selfGetter]);
attempt("a literal string", () => ["text".whoAmI(), `t`.selfGetter, ("a" + "b").sameAs("ab")]);
attempt("a literal boolean, a BigInt and a symbol", () => [true.whoAmI(), 5n.whoAmI(), Symbol.iterator.selfGetter]);
attempt("null and undefined have no members", () => null.whoAmI());
for (let i = 0; i < 2000; i++) callOn(i);
attempt("after 2000 numbers at one place", () => [callOn("text"), callOn(true), callOn(5n), callOn(new Number(5)), callOn({ whoAmI: () => "its own" }), callOn(1.5)]);
