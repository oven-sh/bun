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

function remainder(a, b) {
  return a % b;
}

function remainderOfInt32(a, b) {
  return (a | 0) % (b | 0);
}

function remainderTruncated(a, b) {
  return ((a | 0) % (b | 0)) | 0;
}

function quotient(a, b) {
  return a / b;
}

function quotientOfInt32(a, b) {
  return (a | 0) / (b | 0);
}

function quotientTruncated(a, b) {
  return ((a | 0) / (b | 0)) | 0;
}

function quotientFloored(a, b) {
  return Math.floor(a / b);
}

function quotientUnsigned(a, b) {
  return ((a >>> 0) / (b >>> 0)) >>> 0;
}

function remainderByEight(a) {
  return [a % 8, (a | 0) % 8, a & 7];
}

function isOdd(a) {
  return [a % 2 === 1, a % 2 !== 0, (a & 1) === 1];
}

function wrapped(a, b) {
  return ((a % b) + b) % b;
}

const uses = [remainder, remainderOfInt32, remainderTruncated, quotient, quotientOfInt32, quotientTruncated, quotientFloored, quotientUnsigned, wrapped];
const pairs = [
  [7, 3],
  [-7, 3],
  [7, -3],
  [-7, -3],
  [-5, 5],
  [5, -5],
  [5, 5],
  [0, 5],
  [0, -5],
  [-0, 5],
  [5, 0],
  [-5, 0],
  [0, 0],
  [5, -0],
  [-2147483648, -1],
  [-2147483648, 1],
  [-2147483648, 2147483647],
  [2147483647, -2147483648],
  [-2147483648, -2147483648],
  [2147483647, 2],
  [1, 3],
  [6, 4],
  [5.5, 2],
  [-5.5, 2],
  [5, 2.5],
  [5, Infinity],
  [-5, Infinity],
  [Infinity, 5],
  [NaN, 5],
  [4294967296, 3],
  [1e21, 7],
];

for (let i = 0; i < 2000; i++) {
  for (const use of uses) use(i * 6, 3);
  remainderByEight(i);
  isOdd(i);
}
for (const use of uses) for (const [a, b] of pairs) attempt(use.name + "(" + show(a) + ", " + show(b) + ")", () => use(a, b));
for (const a of [9, -9, -8, 8, -1, 0, -0, -2147483648, 2147483647, 2147483649, -2147483649, 1.5, -1.5]) {
  attempt("remainderByEight(" + show(a) + ")", () => remainderByEight(a));
  attempt("isOdd(" + show(a) + ")", () => isOdd(a));
}
