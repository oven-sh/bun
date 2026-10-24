function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function less(a, b) {
  return a < b;
}

function atMost(a, b) {
  return a <= b;
}

function lessThanTen(a) {
  return a < 10;
}

function lessThanTheTextTen(a) {
  return a < "10";
}

function smaller(a, b) {
  return a < b ? a : b;
}

function between(value, low, high) {
  return low <= value && value <= high;
}

function order(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function largest(list) {
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (list[i] > best) best = list[i];
  return best;
}

for (let i = 0; i < 2000; i++) {
  less(i, 5);
  atMost(i, 5);
  lessThanTen(i);
  lessThanTheTextTen(String(i));
  smaller(i, 5);
  between(i, 1, 9);
  order(i, 5);
  largest([i, 5, 2]);
}

const pairs = [[9, 10], ["9", "10"], ["9", 10], [9, "10"], ["09", "9"], ["a", "b"], ["a", 1], ["", 0], [" ", 0], ["1e1", 10], ["1e1", "10"], ["0x10", 16], [null, 0], [undefined, 0], [null, undefined], [true, 1], [true, "1"], [[9], [10]], [[9], 10], ["9", 10n], [9n, "10"], ["x", 10n], [9.5, 10n], [10n, 10], [NaN, NaN], [-0, 0], ["-0", 0], [{}, {}], [{ valueOf: () => 9 }, { valueOf: () => 10 }], [new Date(9), new Date(10)], ["Z", "a"], ["é", "z"]];
for (const [a, b] of pairs) {
  const label = "(" + show(a) + ", " + show(b) + ")";
  attempt("less" + label, () => [less(a, b), less(b, a)]);
  attempt("atMost" + label, () => [atMost(a, b), atMost(b, a)]);
  attempt("smaller" + label, () => smaller(a, b));
  attempt("order" + label, () => [order(a, b), order(b, a)]);
}
for (const value of [9, "9", "09", "10", "100", "9.5", "a", "", null, undefined, [9], 9n, true]) {
  attempt("lessThanTen(" + show(value) + ")", () => lessThanTen(value));
  attempt("lessThanTheTextTen(" + show(value) + ")", () => lessThanTheTextTen(value));
  attempt("between(" + show(value) + ", 1, 10)", () => between(value, 1, 10));
  attempt("between(" + show(value) + ", '1', '10')", () => between(value, "1", "10"));
}
attempt("largest of numbers", () => largest([9, 10, 8]));
attempt("largest of texts", () => largest(["9", "10", "8"]));
attempt("largest of both", () => largest(["9", 10, "8"]));
attempt("largest with undefined", () => largest([9, undefined, 10]));
attempt("largest with NaN first", () => largest([NaN, 9, 10]));
