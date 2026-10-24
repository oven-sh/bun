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

function shifted(value, count) {
  return value << count;
}

function shiftedThenAdded(value, count) {
  return (value << count) + (value << count);
}

function doubledByAShift(value) {
  let n = value | 0;
  const seen = [];
  for (let i = 0; i < 34; i++) {
    n <<= 1;
    if (i > 27) seen.push(n);
  }
  return seen;
}

function doubledByASum(value) {
  let n = value | 0;
  const seen = [];
  for (let i = 0; i < 34; i++) {
    n = n + n;
    if (i > 27) seen.push(n);
  }
  return seen;
}

function doubledByAProduct(value) {
  let n = value | 0;
  const seen = [];
  for (let i = 0; i < 34; i++) {
    n *= 2;
    if (i > 27) seen.push(n);
  }
  return seen;
}

function powerOfTwo(count) {
  return [1 << count, 2 ** count, Math.pow(2, count), (1 << count) >>> 0];
}

function mask(count) {
  return [(1 << count) - 1, ~(-1 << count), -1 >>> (32 - count)];
}

for (let i = 0; i < 2000; i++) {
  shifted(i, i & 7);
  shiftedThenAdded(i, i & 7);
  powerOfTwo(i & 7);
  mask(i & 7);
}
for (const [value, count] of [[1, 30], [1, 31], [1, 32], [1, 33], [1, -1], [3, 30], [3, 31], [-1, 31], [1073741824, 1], [2147483647, 1], [-2147483648, 1], [5, 0], [1, 63], [1, 64], [1, 1.9], [1.9, 1], [4294967297, 1]]) {
  attempt("shifted(" + value + ", " + count + ")", () => shifted(value, count));
  attempt("shiftedThenAdded(" + value + ", " + count + ")", () => shiftedThenAdded(value, count));
}
for (const value of [1, 3, -1]) {
  attempt("doubledByAShift(" + value + ")", () => doubledByAShift(value));
  attempt("doubledByASum(" + value + ")", () => doubledByASum(value));
  attempt("doubledByAProduct(" + value + ")", () => doubledByAProduct(value));
}
for (const count of [0, 1, 30, 31, 32, 33, 52, 53]) {
  attempt("powerOfTwo(" + count + ")", () => powerOfTwo(count));
  attempt("mask(" + count + ")", () => mask(count));
}
