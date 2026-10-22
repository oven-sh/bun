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

function simple(a, b) {
  arguments[0] = "stored";
  b = "assigned";
  return [a, arguments[0], b, arguments[1]];
}
function withADefault(a, b = 2) {
  arguments[0] = "stored";
  b = "assigned";
  return [a, arguments[0], b, arguments[1]];
}
function withADefaultOnTheFirst(a = 1, b) {
  arguments[0] = "stored";
  b = "assigned";
  return [a, arguments[0], b, arguments[1]];
}
function withRest(a, ...rest) {
  arguments[0] = "stored";
  arguments[1] = "stored too";
  rest[0] = "assigned";
  return [a, arguments[0], rest, arguments[1]];
}
function withAPattern(a, { b }) {
  arguments[0] = "stored";
  b = "assigned";
  return [a, arguments[0], b, arguments[1]];
}
function withAListPattern(a, [b]) {
  arguments[0] = "stored";
  b = "assigned";
  return [a, arguments[0], b, arguments[1]];
}
function defaultReadsArguments(a, b = arguments[0]) {
  a = "assigned";
  return [a, b, arguments[0]];
}
function defaultStoresToArguments(a, b = (arguments[0] = "stored by a default")) {
  return [a, b, arguments[0]];
}
var arrowInside = function (a) {
  var inner = () => {
    arguments[0] = "stored by an arrow";
    return a;
  };
  return [inner(), a, arguments[0]];
};
function number(n, step = 1) {
  arguments[0] = "5";
  return n + step;
}
function list(items, ...more) {
  arguments[0] = "text";
  return items.length + more.length;
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += number(i) + list([i], 1);
console.log("sum", sum);
attempt("simple", () => simple(1, 2));
attempt("with a default", () => withADefault(1, 2));
attempt("with a default that is used", () => withADefault(1));
attempt("with a default on the first", () => withADefaultOnTheFirst(1, 2));
attempt("with a default on the first that is used", () => withADefaultOnTheFirst(undefined, 2));
attempt("with rest", () => withRest(1, 2, 3));
attempt("with a pattern", () => withAPattern(1, { b: 2 }));
attempt("with a list pattern", () => withAListPattern(1, [2]));
attempt("a default reads arguments", () => defaultReadsArguments(1));
attempt("a default stores to arguments", () => defaultStoresToArguments(1));
attempt("an arrow inside", () => arrowInside(1));
attempt("number", () => number(1));
attempt("list", () => list([1, 2], 3));
