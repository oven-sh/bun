// A `get` trap must answer with the value of a property of the target that is neither configurable nor writable, and with undefined for
// an accessor that is not configurable and has no getter. Every kind of value, the same and another. A trap that compiled code calls
// directly has its answer validated on every read.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function counted() { return count("operationAOTGetByIdAndCache") > 0; }
function validated() { return count("operationAOTValidateAnswerOfProxyTrap") + count("operationAOTValidateAnswerOfGetTrap"); }
function read(o) { return o.wanted; }
function show(value) { return typeof value === "symbol" ? String(value) : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" && value !== null ? "object" : typeof value === "function" ? "function" : String(value); }
function attempt(label, target, answer) {
  var said;
  try { said = show(read(new Proxy(target, { get() { return answer; } }))); } catch (error) { said = "threw " + error.constructor.name; }
  console.log(label + ": " + said);
}
var object = {}, symbol = Symbol("s"), f = function () {};
var values = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, 2147483648, "", "text", "te" + String("xt"), 10n, 10n + 0n, symbol, object, f];
for (var stored of values) {
  for (var answer of values) {
    var fixed = {}; Object.defineProperty(fixed, "wanted", { value: stored });
    attempt("fixed " + show(stored) + ", answered " + show(answer), fixed, answer);
  }
}
for (var answer of [undefined, 1]) {
  var o;
  o = {}; Object.defineProperty(o, "wanted", { value: 0, writable: true }); attempt("writable, answered " + show(answer), o, answer);
  o = {}; Object.defineProperty(o, "wanted", { value: 0, configurable: true }); attempt("configurable, answered " + show(answer), o, answer);
  o = {}; Object.defineProperty(o, "wanted", { get() { return 0; } }); attempt("a fixed getter, answered " + show(answer), o, answer);
  o = {}; Object.defineProperty(o, "wanted", { set(v) {} }); attempt("a fixed setter alone, answered " + show(answer), o, answer);
  o = {}; Object.defineProperty(o, "wanted", { set(v) {}, configurable: true }); attempt("a setter alone, answered " + show(answer), o, answer);
  o = Object.freeze({ other: 1 }); attempt("frozen and absent, answered " + show(answer), o, answer);
  o = Object.create(Object.freeze({ wanted: 0 })); attempt("fixed on the prototype, answered " + show(answer), o, answer);
  o = function () {}; Object.defineProperty(o, "wanted", { value: 1 }); attempt("fixed on a function, answered " + show(answer), o, answer);
  o = function () {}; attempt("absent on a function, answered " + show(answer), o, answer);
  o = [1]; Object.defineProperty(o, "wanted", { value: 1 }); attempt("fixed on an array, answered " + show(answer), o, answer);
  o = new Proxy(Object.freeze({ wanted: 1 }), {}); attempt("fixed behind another proxy, answered " + show(answer), o, answer);
}
function named() {}
Object.defineProperties(named, { wanted: { value: symbol }, other: { value: "id" } });
var reference = new Proxy(named, { get(t, key) { return t[key]; } });
read(reference);
var before = validated(), same = true;
for (var i = 0; i < 100; i++) same = read(reference) === symbol && same;
console.log(same, !counted() || validated() - before === 100);
