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

function product(a, b) {
  return a * b;
}

function productTruncated(a, b) {
  return (a * b) | 0;
}

function productOfInt32Truncated(a, b) {
  return ((a | 0) * (b | 0)) | 0;
}

function productUnsigned(a, b) {
  return (a * b) >>> 0;
}

function imul(a, b) {
  return Math.imul(a, b);
}

function productMasked(a, b) {
  return (a * b) & 65535;
}

function productModulo(a, b) {
  return (a * b) % 1000;
}

function productPlusOne(a, b) {
  return a * b + 1;
}

function congruential(seed) {
  let state = seed | 0;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    state = (state * 1103515245 + 12345) | 0;
    seen.push(state);
  }
  return seen;
}

function congruentialWithImul(seed) {
  let state = seed | 0;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    seen.push(state);
  }
  return seen;
}

function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

const uses = [product, productTruncated, productOfInt32Truncated, productUnsigned, imul, productMasked, productModulo, productPlusOne];
const pairs = [
  [3, 4],
  [2147483647, 2147483647],
  [2147483647, 2147483645],
  [-2147483648, 2147483647],
  [-2147483648, -2147483648],
  [94906267, 94906267],
  [94906266, 94906266],
  [134217729, 134217729],
  [1103515245, 2147483647],
  [4294967295, 4294967295],
  [16777217, 16777217],
  [9007199254740991, 2],
  [9007199254740991, 3],
  [65535, 65537],
  [123456789, 987654321],
];

for (let i = 0; i < 2000; i++) for (const use of uses) use(i, 3);
for (const use of uses) for (const [a, b] of pairs) attempt(use.name + "(" + a + ", " + b + ")", () => use(a, b));
for (const seed of [1, 42, 2147483647, -1]) {
  attempt("congruential(" + seed + ")", () => congruential(seed));
  attempt("congruentialWithImul(" + seed + ")", () => congruentialWithImul(seed));
}
for (const n of [5, 12, 13, 18, 19, 22, 23, 25, 170, 171]) attempt("factorial(" + n + ")", () => factorial(n));
