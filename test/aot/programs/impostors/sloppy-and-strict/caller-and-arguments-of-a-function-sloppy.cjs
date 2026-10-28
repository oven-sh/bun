console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function whoCalls() {
  return whoCalls.caller === null ? "null" : typeof whoCalls.caller === "function" ? whoCalls.caller.name : typeof whoCalls.caller;
}
function namedCaller() {
  return whoCalls();
}
function operandsFromOutside() {
  return readOperands();
}
function readOperands() {
  var operands = operandsFromOutside.arguments;
  return operands === null ? "null" : typeof operands === "object" ? Array.from(operands) : typeof operands;
}
function ownOperands(a, b) {
  var operands = ownOperands.arguments;
  return operands === null ? "null" : [operands.length, operands === arguments];
}
function notRunning() {}
var arrow = () => 1;
var method = {
  method() {},
}.method;
class Klass {}
var bound = notRunning.bind(null);
async function asynchronous() {}
function* generator() {}

attempt("caller from the top level", whoCalls);
attempt("caller from a named function", namedCaller);
attempt("arguments of a running caller", () => operandsFromOutside(1, 2));
attempt("arguments of itself", () => ownOperands(1, 2));
var functions = { notRunning, arrow, method, Klass, bound, asynchronous, generator };
for (var name in functions) {
  var callee = functions[name];
  attempt(name + ".caller", () => callee.caller);
  attempt(name + ".arguments", () => callee.arguments);
  attempt(name + " has its own caller", () => [Object.hasOwn(callee, "caller"), Object.hasOwn(callee, "arguments"), "caller" in callee]);
  attempt(name + ".caller stored to", () => {
    callee.caller = 1;
    return "no error";
  });
  attempt(name + ".arguments stored to", () => {
    callee.arguments = 1;
    return "no error";
  });
}
attempt("on Function.prototype", () => Object.getOwnPropertyNames(Function.prototype).filter(name => name === "caller" || name === "arguments").sort());
attempt("the getter on a stranger", () => Object.getOwnPropertyDescriptor(Function.prototype, "caller").get.call({}));
