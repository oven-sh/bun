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

function factorial(n) {
  return n <= 1 ? 1 : n * arguments.callee(n - 1);
}
function itself() {
  return arguments.callee === itself;
}
function kind() {
  return typeof arguments.callee;
}
function stored() {
  arguments.callee = "stored";
  return arguments.callee;
}
function removed() {
  return [delete arguments.callee, "callee" in arguments];
}
function described() {
  var property = Object.getOwnPropertyDescriptor(arguments, "callee");
  return [typeof property.value, typeof property.get, typeof property.set, property.enumerable, property.configurable, property.get === property.set];
}
function handedOut() {
  return arguments;
}
function withADefault(a = 1) {
  return typeof arguments.callee;
}
function throughAnArrow() {
  return (() => arguments.callee === throughAnArrow)();
}
function keys() {
  return Reflect.ownKeys(arguments).map(String);
}
function computed(name) {
  return typeof arguments[name];
}
var anonymous = [
  function (n) {
    return n <= 0 ? "done" : arguments.callee(n - 1);
  },
][0];

var uses = { itself, kind, stored, removed, described, withADefault, throughAnArrow, keys };
attempt("factorial", () => factorial(5));
for (var name in uses) attempt(name, uses[name]);
attempt("anonymous", () => anonymous(3));
attempt("computed", () => computed("callee"));
attempt("computed, another name", () => computed("length"));
attempt("read from outside", () => handedOut().callee === handedOut);
attempt("called from outside", () => typeof handedOut().callee());
attempt("caller of arguments", () => "caller" in handedOut());
var sum = 0;
for (var i = 0; i < 2000; i++) {
  try {
    sum += factorial(3);
  } catch (error) {
    sum -= 1;
  }
}
console.log("sum", sum);
