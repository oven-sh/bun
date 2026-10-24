function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function fibonacci(n) {
  return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}

function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}

function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}

function countDown(n) {
  return n > 0 ? countDown(n - 1) : n;
}

function sumTree(node) {
  if (node === null) return 0;
  return node.value + sumTree(node.left) + sumTree(node.right);
}

function flatten(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (Array.isArray(list[i])) out.push(...flatten(list[i]));
    else out.push(list[i]);
  }
  return out;
}

function reverse(text) {
  return text.length === 0 ? "" : reverse(text.slice(1)) + text[0];
}

const leaf = value => ({ value, left: null, right: null });

function honest(round) {
  console.log(round, "factorial", factorial(0), factorial(1), factorial(5), factorial(10), factorial(20));
  console.log(round, "fibonacci", fibonacci(0), fibonacci(1), fibonacci(7), fibonacci(12));
  console.log(round, "isEven", isEven(0), isEven(1), isEven(10), isOdd(7), isOdd(8));
  console.log(round, "countDown", countDown(0), countDown(3), countDown(100));
  console.log(round, "sumTree", sumTree(null), sumTree(leaf(1)), sumTree({ value: 1, left: leaf(2), right: { value: 3, left: leaf(4), right: null } }));
  console.log(round, "flatten", show(flatten([1, [2, [3, [4]]]])), show(flatten([])), show(flatten([[], [[]]])));
  console.log(round, "reverse", reverse("abc"), reverse(""), reverse("x"), reverse("hello"));
}

const notNumbers = [
  ["a numeric string", () => "4"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 4) })],
  ["a BigInt", () => 4n],
  ["a fraction", () => 2.5],
  ["negative zero", () => -0],
  ["an array of one", () => [4]],
  ["true", () => true],
  ["null", () => null],
];

honest("before");
for (const [name, make] of notNumbers) {
  attempt("factorial of " + name, () => factorial(make()));
  attempt("fibonacci of " + name, () => fibonacci(make()));
  attempt("countDown from " + name, () => countDown(make()));
  attempt("factorial as a callback of " + name, () => [make()].map(factorial)[0]);
}
attempt("isEven of a numeric string", () => isEven("4"));
attempt("isOdd of an array of one", () => isOdd([3]));
attempt("isEven of negative zero", () => isEven(-0));
attempt("isEven of true", () => isEven(true));
attempt("factorial of 171", () => factorial(171));
attempt("countDown from undefined", () => countDown(undefined));
attempt("countDown from NaN", () => countDown(NaN));

attempt("a string in a deep leaf", () => sumTree({ value: 1, left: leaf(2), right: { value: 3, left: leaf("4"), right: leaf(5) } }));
attempt("a tree from JSON with a string at the root", () => sumTree(JSON.parse('{"value":"1","left":{"value":2,"left":null,"right":null},"right":null}')));
attempt("a leaf without a right member", () => sumTree({ value: 1, left: null }));
attempt("a leaf of another key order", () => sumTree({ right: null, left: leaf(2), value: 1 }));
attempt("a leaf with getters", () => sumTree({ get value() { log.push("value"); return 1; }, get left() { log.push("left"); return null; }, get right() { log.push("right"); return leaf(2); } }));
attempt("a BigInt in a leaf", () => sumTree({ value: 1, left: leaf(2n), right: null }));
attempt("undefined for the tree", () => sumTree(undefined));

attempt("flatten a string", () => flatten("ab"));
attempt("flatten an array-like object that holds an array", () => flatten({ length: 2, 0: [1, [2]], 1: 3 }));
attempt("flatten an array that holds a typed array", () => flatten([1, new Uint8Array([2, 3])]));
attempt("flatten an array that holds a subclass", () => flatten([1, new (class extends Array {})(2, 3)]));
attempt("flatten holes", () => flatten([1, , [2, , 3]]));
attempt("flatten a proxy of an array inside an array", () => flatten([new Proxy([1, [2]], {})]));

attempt("reverse an array", () => reverse(["a", "b", "c"]));
attempt("reverse a String object", () => reverse(new String("abc")));
attempt("reverse a number", () => reverse(123));
attempt("reverse null", () => reverse(null));
honest("after");
