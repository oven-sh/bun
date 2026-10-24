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

function plusOne(n) {
  arguments[0] = "5";
  return n + 1;
}
function times(n) {
  arguments[0] = {
    valueOf: function () {
      return 7;
    },
  };
  return n * 2;
}
function counted(n) {
  arguments[0] = 3;
  var count = 0;
  for (var i = 0; i < n; i++) count++;
  return count;
}
function bits(n) {
  arguments[0] = 2.5;
  return [n | 0, n];
}
function incremented(n) {
  arguments[0] = 2147483647;
  n++;
  return n;
}
function compared(n) {
  arguments[0] = undefined;
  return [n < 1, n === undefined, typeof n];
}
function sometimes(n, change) {
  if (change) arguments[0] = "text";
  return n + 1;
}
function second(a, b) {
  arguments[1] = 10;
  return a + b;
}
function byAComputedIndex(n, index) {
  arguments[index] = "stored";
  return n;
}
function pastTheOperands(n, m) {
  arguments[1] = "stored";
  return [n, m, arguments.length];
}
function grows(n) {
  var sum = 0;
  for (var i = 0; i < 3; i++) {
    sum += n;
    arguments[0] = n + 1;
  }
  return sum;
}
function big(n) {
  arguments[0] = 1n;
  return n + 1;
}
function minusZero(n) {
  arguments[0] = -0;
  return [n, 1 / n];
}
function index(n) {
  arguments[0] = "length";
  return [10, 20, 30][n];
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += sometimes(i, false) + byAComputedIndex(i, 5);
console.log("sum", sum);
attempt("plusOne", () => plusOne(1));
attempt("times", () => times(1));
attempt("counted", () => counted(1));
attempt("bits", () => bits(1));
attempt("incremented", () => incremented(1));
attempt("compared", () => compared(0));
attempt("sometimes, changed", () => sometimes(1, true));
attempt("sometimes, unchanged", () => sometimes(1, false));
attempt("second", () => second(1, 2));
attempt("by a computed index 0", () => byAComputedIndex(1, 0));
attempt("by a computed index '0'", () => byAComputedIndex(1, "0"));
attempt("by a computed index 1", () => byAComputedIndex(1, 1));
attempt("by a computed index -0", () => byAComputedIndex(1, -0));
attempt("past the operands", () => pastTheOperands(1));
attempt("no operands at all", () => plusOne());
attempt("grows", () => grows(1));
attempt("big", () => big(1));
attempt("minus zero", () => minusZero(1));
attempt("index", () => index(1));
attempt("through call", () => plusOne.call(null, 1));
attempt("through apply", () => plusOne.apply(null, [1]));
attempt("through a spread", () => plusOne(...[1]));
attempt("as a callback", () => [1, 2].map(plusOne));

export {};
