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

function sizeOfFirst(list) {
  return list.length;
}
function assigned(a) {
  a = "changed";
  return arguments[0];
}
function incremented(a) {
  a++;
  return arguments[0];
}
function addedTo(a) {
  a += "!";
  return arguments[0];
}
function fromAPattern(a) {
  [a] = ["from a pattern"];
  return arguments[0];
}
function inAClosure(a) {
  (function () {
    a = "from a closure";
  })();
  return arguments[0];
}
function byEval(a) {
  eval("a = 'from eval'");
  return arguments[0];
}
function applied(a, b) {
  a = 10;
  b = 20;
  return Math.max.apply(null, arguments);
}
function spread(a, b) {
  a = 10;
  return [...arguments];
}
function notPassed(a, b) {
  b = "set";
  return [arguments.length, arguments[1], 1 in arguments];
}
function passedOn(a) {
  a = [1, 2, 3];
  return sizeOfFirst.apply(null, arguments);
}
function loopVariable(a) {
  for (a = 0; a < 3; a++);
  return arguments[0];
}
function logical(a) {
  a ||= "filled in";
  return arguments[0];
}
function sometimes(a, change) {
  if (change) a = "changed";
  return arguments[0] + 1;
}
function readFirst(a) {
  var before = arguments[0];
  a = "changed";
  return [before, arguments[0]];
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += sometimes(i, false);
console.log("sum", sum);
var uses = { assigned, incremented, addedTo, fromAPattern, inAClosure, byEval, applied, spread, notPassed, passedOn, loopVariable, readFirst };
for (var name in uses) attempt(name, uses[name].bind(null, 1));
attempt("applied with two", () => applied(1, 2));
attempt("spread with two", () => spread(1, 2));
attempt("logical", () => [logical(0), logical(5)]);
attempt("sometimes, changed", () => sometimes(1, true));
attempt("sometimes, unchanged", () => sometimes(1, false));
