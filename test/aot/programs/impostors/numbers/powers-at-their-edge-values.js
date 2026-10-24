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

function operator(base, exponent) {
  return base ** exponent;
}

function mathPow(base, exponent) {
  return Math.pow(base, exponent);
}

function truncated(base, exponent) {
  return (base ** exponent) | 0;
}

function assigned(base, exponent) {
  base **= exponent;
  return base;
}

function square(x) {
  return x ** 2;
}

function cube(x) {
  return x ** 3;
}

function root(x) {
  return x ** 0.5;
}

function reciprocal(x) {
  return x ** -1;
}

function inverseRoot(x) {
  return x ** -0.5;
}

function tenToThe(n) {
  return 10 ** n;
}

function twoToThe(n) {
  return 2 ** n;
}

function mathTenToThe(n) {
  return Math.pow(10, n);
}

for (let i = 0; i < 2000; i++) {
  operator(i & 7, i & 3);
  mathPow(i & 7, i & 3);
  truncated(i & 7, i & 3);
  assigned(i & 7, i & 3);
  square(i);
  cube(i & 255);
  root(i * i);
  reciprocal(i + 1);
}

const pairs = [[2, 10], [2, 30], [2, 31], [2, 32], [2, 53], [2, 64], [2, 1023], [2, 1024], [2, -1], [2, -1074], [2, -1075], [-2, 31], [-2, 32], [-2, 3], [10, 21], [10, 22], [10, -7], [3, 40], [7, 19], [0, 0], [-0, 0], [0, -1], [-0, -1], [-0, -2], [-0, 3], [-0, 2], [0, 0.5], [-8, 1 / 3], [-8, 0.5], [4, 0.5], [4, -0.5], [1, Infinity], [1, -Infinity], [-1, Infinity], [1, NaN], [NaN, 0], [NaN, -0], [NaN, 1], [0.5, Infinity], [2, Infinity], [2, -Infinity], [Infinity, 0], [Infinity, -1], [-Infinity, 3], [-Infinity, 2], [-Infinity, -3], [46341, 2], [65536, 2], [2147483647, 2], [-2147483648, 2], [1.0000001, 1e8], [5, 1], [5, 1.5]];
for (const [base, exponent] of pairs) {
  const label = "(" + show(base) + ", " + show(exponent) + ")";
  attempt("operator" + label, () => operator(base, exponent));
  attempt("mathPow" + label, () => mathPow(base, exponent));
  attempt("truncated" + label, () => truncated(base, exponent));
  attempt("assigned" + label, () => assigned(base, exponent));
}
for (const x of [3, -3, 0, -0, 46340, 46341, 65536, 2147483647, -2147483648, 1.5, 1e200, NaN, Infinity, -Infinity, 94906267]) {
  attempt("square(" + show(x) + ")", () => square(x));
  attempt("cube(" + show(x) + ")", () => cube(x));
  attempt("root(" + show(x) + ")", () => root(x));
  attempt("reciprocal(" + show(x) + ")", () => reciprocal(x));
}
for (const x of [2, 3, 5, 7, 10, 0.1, 0.3, 1e10, 123456789, 4, 0, -0, -1, Infinity, -Infinity, NaN]) attempt("inverseRoot(" + show(x) + ")", () => inverseRoot(x));
attempt("powers of ten that differ from their literals", () => {
  const differing = [];
  for (let n = 0; n <= 310; n++) if (tenToThe(n) !== Number("1e" + n)) differing.push(n);
  return differing;
});
attempt("powers of ten by Math.pow against the operator", () => {
  const differing = [];
  for (let n = -330; n <= 310; n++) if (!Object.is(tenToThe(n), mathTenToThe(n))) differing.push(n);
  return differing;
});
attempt("some powers of ten", () => [-324, -323, -308, -22, -1, 0, 1, 15, 16, 22, 23, 29, 100, 308, 309, 0.5, -0, NaN, "3", null].map(tenToThe));
attempt("some powers of two", () => [-1075, -1074, -1023, -1022, -1, -0, 0, 1, 30, 31, 32, 52, 53, 62, 63, 64, 1023, 1024, 0.5, 1.5, NaN, Infinity, -Infinity, "3", null, undefined, true].map(twoToThe));
attempt("powers of two multiply back to one", () => {
  const wrong = [];
  for (let n = -1022; n <= 1022; n++) if (twoToThe(n) * twoToThe(-n) !== 1) wrong.push(n);
  return wrong;
});
