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

function aVar(a) {
  var a;
  return a;
}
function aVarWithAValue(a) {
  var a = "the var";
  return [a, arguments[0]];
}
function aFunctionUsedLikeANumber(a) {
  var before = a + 1;
  function a() {}
  return typeof before;
}
function aVarInABlock(a) {
  if (a > 1) {
    var a = "from the block";
  }
  return a;
}
function aVarInALoop(a) {
  for (var a = a || 0; a < 3; a++);
  return a;
}
function aVarAfterTheUse(a) {
  var seen = a.length;
  var a = 5;
  return [seen, a];
}
function aDefaultSeesTheOuterName(a = outer, outer) {
  return [a, outer];
}
function aVarWithADefault(a = 1) {
  var a;
  return a;
}
function aVarWithADefaultAndAClosure(a, read = () => a) {
  var a = "the var";
  return [a, read()];
}
function aCatchParameter(a) {
  try {
    throw "thrown";
  } catch (a) {
    var a = "stored in catch";
  }
  return a;
}
function namedLikeTheFunction(namedLikeTheFunction) {
  return namedLikeTheFunction;
}
var outer = "the outer variable";

var uses = { aVar, aVarWithAValue, aFunctionUsedLikeANumber, aVarInABlock, aVarInALoop, aDefaultSeesTheOuterName, aVarWithADefault, aVarWithADefaultAndAClosure, aCatchParameter, namedLikeTheFunction };
for (var name in uses) {
  attempt(name + "(1)", uses[name].bind(null, 1));
  attempt(name + "(2)", uses[name].bind(null, 2));
  attempt(name + "()", uses[name]);
}
attempt("aVarAfterTheUse([1, 2])", () => aVarAfterTheUse([1, 2]));
attempt("aVarAfterTheUse('abc')", () => aVarAfterTheUse("abc"));
attempt("aVarAfterTheUse()", () => aVarAfterTheUse());
