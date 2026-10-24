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

const marks = ["a", "b", "c", "d"];

function lengthInAVariable(list) {
  let n = 0;
  n = list.length;
  return [n, n + 1, n | 0, marks[n & 3], n - 1, n * 2];
}

function lastIndex(list) {
  let last = 0;
  last = list.length - 1;
  return [last, last | 0, list[last], marks[last & 3]];
}

function sumOfLengths(a, b) {
  let total = 0;
  total = a.length + b.length;
  return [total, total | 0, marks[total & 3], total >>> 0];
}

function differenceOfLengths(a, b) {
  let difference = 0;
  difference = a.length - b.length;
  return [difference, difference | 0, marks[difference & 3]];
}

function countedDown(list) {
  let n = list.length;
  const seen = [];
  while (n > list.length - 3 && n > 0) {
    n--;
    seen.push(n, n & 3);
  }
  return seen;
}

function halfway(list) {
  let middle = 0;
  middle = list.length >> 1;
  let unsignedMiddle = 0;
  unsignedMiddle = list.length >>> 1;
  return [middle, unsignedMiddle, marks[middle & 3]];
}

function sparse(length) {
  const list = [];
  list.length = length;
  return list;
}

for (let i = 0; i < 1000; i++) {
  lengthInAVariable([i, i]);
  lastIndex([i, i]);
  sumOfLengths([i], [i, i]);
  differenceOfLengths([i], [i, i]);
  countedDown([i, i, i]);
  halfway([i, i, i]);
}

for (const length of [3, 2147483647, 2147483648, 4294967295]) {
  attempt("lengthInAVariable " + length, () => lengthInAVariable(sparse(length)));
  attempt("lastIndex " + length, () => lastIndex(sparse(length)));
  attempt("sumOfLengths " + length, () => sumOfLengths(sparse(length), sparse(length)));
  attempt("differenceOfLengths " + length, () => differenceOfLengths([], sparse(length)));
  attempt("countedDown " + length, () => countedDown(sparse(length)));
  attempt("halfway " + length, () => halfway(sparse(length)));
}
for (const [label, value] of [["an array-like with a fraction", { length: 2.5 }], ["an array-like with a text", { length: "3" }], ["an array-like with 2 ** 40", { length: 2 ** 40 }], ["an array-like without a length", {}], ["a string", "abc"], ["a function", function (a, b) {}], ["a typed array", new Uint8Array(3)], ["an array-like with -0", { length: -0 }]]) {
  attempt("lengthInAVariable of " + label, () => lengthInAVariable(value));
  attempt("lastIndex of " + label, () => lastIndex(value));
  attempt("sumOfLengths of " + label, () => sumOfLengths(value, value));
  attempt("halfway of " + label, () => halfway(value));
}

const shared = [1, 2, 3];
const other = [4, 5];

function lengthOfAKnownArray() {
  let n = shared.length;
  const first = [n, n + 1, n | 0, marks[n & 3]];
  n = shared.length - 1;
  n++;
  return [first, n, n | 0, marks[n & 3]];
}

function sumOfKnownLengths() {
  let total = shared.length + other.length;
  total = total + other.length;
  return [total, total | 0, marks[total & 3], total - shared.length];
}

function complementOfAKnownLength() {
  let n = ~shared.length;
  n = n - 1;
  return [n, marks[n & 3], ~n];
}

function countedOverAKnownArray() {
  let count = 0;
  for (let i = shared.length - 2; i < shared.length; i++) count++;
  return count;
}

for (let i = 0; i < 1000; i++) {
  lengthOfAKnownArray();
  sumOfKnownLengths();
  complementOfAKnownLength();
  countedOverAKnownArray();
}
for (const length of [3, 2147483647, 2147483648, 4294967295, 0]) {
  shared.length = length;
  other.length = length;
  attempt("lengthOfAKnownArray at " + length, lengthOfAKnownArray);
  attempt("sumOfKnownLengths at " + length, sumOfKnownLengths);
  attempt("complementOfAKnownLength at " + length, complementOfAKnownLength);
  attempt("countedOverAKnownArray at " + length, countedOverAKnownArray);
}
