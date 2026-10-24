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

function stores(a, text) {
  eval(text);
  return a;
}
function usedLikeANumber(n, text) {
  eval(text);
  return n + 1;
}
function usedLikeAList(list, text) {
  eval(text);
  return list.length;
}
function answers(a, text) {
  return eval(text);
}
function throughAnArrow(a, text) {
  return (() => eval(text))();
}
function twice(a, text) {
  var before = a;
  eval(text);
  var between = a;
  eval(text + " + '!'");
  return [before, between, a];
}
function withADefault(a, text = "") {
  eval(text);
  return a;
}
function mentionsArgumentsToo(a, text) {
  var count = arguments.length;
  eval(text);
  return [count, a];
}
function assignsTheParameter(a, text) {
  a = "assigned";
  return eval(text);
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += usedLikeANumber(i, "") + usedLikeAList([i], "");
console.log("sum", sum);
attempt("stores", () => stores(1, "arguments[0] = 'stored by the text'"));
attempt("used like a number", () => usedLikeANumber(1, "arguments[0] = '5'"));
attempt("used like a number, a fraction", () => usedLikeANumber(1, "arguments[0] = 0.5"));
attempt("used like a list", () => usedLikeAList([1, 2, 3], "arguments[0] = 'ab'"));
attempt("used like a list, null", () => usedLikeAList([1, 2, 3], "arguments[0] = null"));
attempt("how many", () => answers(1, "arguments.length"));
attempt("how many of three", () => answers(1, "arguments.length", 3));
attempt("the third", () => answers(1, "arguments[2]", "the third operand"));
attempt("the callee", () => answers(1, "typeof arguments.callee"));
attempt("the kind", () => answers(1, "Object.prototype.toString.call(arguments)"));
attempt("through an arrow", () => throughAnArrow(1, "arguments[0] = 'stored'; a"));
attempt("twice", () => twice(1, "arguments[0] = 'stored'"));
attempt("with a default", () => withADefault(1, "arguments[0] = 'stored'"));
attempt("mentions arguments too", () => mentionsArgumentsToo(1, "arguments[0] = 'stored'"));
attempt("assigns the parameter", () => assignsTheParameter(1, "arguments[0]"));
attempt("an indirect eval has no arguments", () => stores(1, "(0, eval)('typeof arguments')"));
attempt("a function in the text has its own", () => answers(1, "(function () { return arguments.length; })()"));
attempt("honest again", () => [usedLikeANumber(1, ""), usedLikeAList([1], "")]);

export {};
