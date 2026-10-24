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

function redeclaresALocal(text) {
  var x = 1;
  eval(text);
  return x;
}
function usesItLikeANumber(text) {
  var x = 1;
  eval(text);
  return x + 1;
}
function declaresANewName(text) {
  eval(text);
  return typeof y === "undefined" ? "no y" : y;
}
function hidesAnOuterName(text) {
  eval(text);
  return outer;
}
function hidesAParameter(x, text) {
  eval(text);
  return x.length;
}
function declaresAFunction(text) {
  eval(text);
  return typeof helper === "function" ? helper() : typeof helper;
}
function hidesAnOuterFunction(text) {
  eval(text);
  return outerFunction();
}
function declaredInALoop(text) {
  var seen = [];
  for (var i = 0; i < 3; i++) {
    seen.push(typeof y);
    if (i === 1) eval(text);
  }
  return seen;
}
function seenByAClosure(text) {
  function read() {
    return typeof y === "undefined" ? "no y" : y;
  }
  var before = read();
  eval(text);
  return [before, read()];
}
function declaresALet(text) {
  var x = 1;
  eval(text);
  return x;
}
function collidesWithALet(text) {
  let x = 1;
  eval(text);
  return x;
}
var outer = "the outer variable";
function outerFunction() {
  return "the outer function";
}

attempt("redeclares a local", () => redeclaresALocal("var x = 'declared by eval'"));
attempt("redeclares a local without a value", () => redeclaresALocal("var x"));
attempt("assigns to a local", () => redeclaresALocal("x = 'assigned by eval'"));
attempt("a text where a number was", () => usesItLikeANumber("var x = '5'"));
attempt("an object where a number was", () => usesItLikeANumber("var x = { valueOf() { return 41; } }"));
attempt("declares a new name", () => declaresANewName("var y = 'declared by eval'"));
attempt("declares nothing", () => declaresANewName(""));
attempt("hides an outer name", () => hidesAnOuterName("var outer = 'declared by eval'"));
attempt("the outer name afterwards", () => outer);
attempt("hides a parameter", () => hidesAParameter([1, 2, 3], "var x = 'ab'"));
attempt("declares a function", () => declaresAFunction("function helper() { return 'declared by eval'; }"));
attempt("hides an outer function", () => hidesAnOuterFunction("function outerFunction() { return 'declared by eval'; }"));
attempt("the outer function afterwards", () => outerFunction());
attempt("declared in a loop", () => declaredInALoop("var y = 1"));
attempt("seen by a closure", () => seenByAClosure("var y = 'declared by eval'"));
attempt("declares a let", () => declaresALet("let x = 'a let of eval'; x"));
attempt("collides with a let", () => collidesWithALet("var x = 'declared by eval'"));
attempt("does not leak", () => [typeof y, typeof helper]);
var sum = 0;
for (var i = 0; i < 2000; i++) sum += usesItLikeANumber("") + hidesAParameter([i], "");
console.log("sum", sum);
attempt("after 2000 empty texts, a number", () => usesItLikeANumber("var x = '5'"));
attempt("after 2000 empty texts, a list", () => hidesAParameter([1, 2, 3], "var x = { length: 'long' }"));
attempt("through an indirect eval", () => {
  var x = 1;
  (0, eval)("var declaredByIndirectEval = 'global'");
  return [x, typeof declaredByIndirectEval, delete globalThis.declaredByIndirectEval];
});
