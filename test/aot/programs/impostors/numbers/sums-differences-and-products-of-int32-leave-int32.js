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

function sum(a, b) {
  return (a | 0) + (b | 0);
}

function difference(a, b) {
  return (a | 0) - (b | 0);
}

function product(a, b) {
  return (a | 0) * (b | 0);
}

function sumTruncated(a, b) {
  return ((a | 0) + (b | 0)) | 0;
}

function differenceTruncated(a, b) {
  return ((a | 0) - (b | 0)) | 0;
}

function productTruncated(a, b) {
  return ((a | 0) * (b | 0)) | 0;
}

function imul(a, b) {
  return Math.imul(a, b);
}

function sumUnsigned(a, b) {
  return ((a | 0) + (b | 0)) >>> 0;
}

function sumOfThree(a, b) {
  return (a | 0) + (b | 0) + (a | 0);
}

function sumOfThreeTruncated(a, b) {
  return ((a | 0) + (b | 0) + (a | 0)) | 0;
}

function accumulated(a, b) {
  let total = a | 0;
  total += b | 0;
  total += b | 0;
  return total;
}

function multipliedInPlace(a, b) {
  let total = a | 0;
  total *= b | 0;
  return total;
}

function average(a, b) {
  return ((a | 0) + (b | 0)) >> 1;
}

function averageUnsigned(a, b) {
  return ((a | 0) + (b | 0)) >>> 1;
}

function compared(a, b) {
  return (a | 0) + 1 > (b | 0);
}

const uses = [sum, difference, product, sumTruncated, differenceTruncated, productTruncated, imul, sumUnsigned, sumOfThree, sumOfThreeTruncated, accumulated, multipliedInPlace, average, averageUnsigned, compared];
const pairs = [
  [3, 4],
  [2147483647, 1],
  [2147483647, 2147483647],
  [-2147483648, -1],
  [-2147483648, 1],
  [-2147483648, -2147483648],
  [2147483647, -2147483648],
  [65536, 65536],
  [65536, 32768],
  [46341, 46341],
  [-46341, 46341],
  [2147483647, 2147483646],
  [94906267, 94906267],
  [-2147483648, 2147483647],
  [0, -5],
  [-5, 0],
  [0, 0],
  [-1, 0],
  [1, -1],
];

for (let i = 0; i < 2000; i++) for (const use of uses) use(i, i + 1);
for (const use of uses) for (const [a, b] of pairs) attempt(use.name + "(" + a + ", " + b + ")", () => use(a, b));
