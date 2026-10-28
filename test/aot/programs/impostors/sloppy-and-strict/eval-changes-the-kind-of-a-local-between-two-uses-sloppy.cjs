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

function size(list, text) {
  var before = list.length;
  eval(text);
  return [before, list.length];
}
function total(list, text) {
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    sum += list[i];
    if (i === 0) eval(text);
  }
  return sum;
}
function next(n, text) {
  var before = n + 1;
  eval(text);
  return [before, n + 1];
}
function counted(n, text) {
  var count = 0;
  for (var i = 0; i < n; i++) {
    count++;
    eval(text);
  }
  return count;
}
function called(callee, text) {
  var before = callee();
  eval(text);
  return [before, callee()];
}
function member(object, text) {
  var before = object.a;
  eval(text);
  return [before, object.a];
}
function afterACheck(value, text) {
  if (typeof value !== "number") return "no number";
  eval(text);
  return value * 2;
}
function aConst(text) {
  const fixed = 1;
  eval(text);
  return fixed;
}
function throughAnArrow(list, text) {
  var run = () => eval(text);
  run();
  return list.length;
}
function throughAnAlias(list, text) {
  var alias = eval;
  alias(text);
  return list.length;
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += size([i], "")[1] + total([i, 1], "") + next(i, "")[1] + member({ a: i }, "")[1] + afterACheck(i, "");
console.log("sum", sum);
attempt("size", () => size([1, 2, 3], "list = 'ab'"));
attempt("size, null", () => size([1, 2, 3], "list = null"));
attempt("total", () => total([1, 2, 3], "list = [10, 20, 30, 40]"));
attempt("total, a text", () => total([1, 2, 3], "list = 'abc'"));
attempt("total, the index", () => total([1, 2, 3], "i = 1.5"));
attempt("next", () => next(1, "n = '1'"));
attempt("next, a bigint", () => next(1, "n = 1n"));
attempt("counted", () => counted(3, "n = 1"));
attempt("counted, a text", () => counted(3, "n = '2'"));
attempt("counted, the counter", () => counted(3, "count = 'x'"));
attempt("called", () => called(() => "honest", "callee = () => 'replaced'"));
attempt("called, no function", () => called(() => "honest", "callee = 5"));
attempt("member", () => member({ a: 1 }, "object = { get a() { return 'from a getter'; } }"));
attempt("member, changed in place", () => member({ a: 1 }, "delete object.a"));
attempt("after a check", () => afterACheck(1, "value = 'ab'"));
attempt("a const", () => aConst("fixed = 2"));
attempt("through an arrow", () => throughAnArrow([1, 2, 3], "list = 'ab'"));
attempt("through an alias", () => throughAnAlias([1, 2, 3], "globalThis.list = 'ab'"));
delete globalThis.list;
attempt("honest again", () => [size([1], ""), total([1, 2], ""), next(1, "")]);
