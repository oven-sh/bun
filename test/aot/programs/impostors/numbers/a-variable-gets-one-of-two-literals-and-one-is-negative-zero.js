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

function startsAsNegativeZero(flag) {
  let z = -0;
  if (flag) z = 1;
  return [z, 1 / z, marks[z], z | 0, Object.is(z, -0)];
}

function choosesNegativeZero(flag) {
  let z = 0;
  z = flag ? 1 : -0;
  return [z, 1 / z, marks[z], z | 0, Object.is(z, -0)];
}

function choosesAFraction(flag) {
  let n = 0;
  n = flag ? 1 : 0.5;
  return [n, marks[n], n | 0, n + 1];
}

function choosesALargeLiteral(flag) {
  let n = 0;
  n = flag ? 1 : 2147483648;
  return [n, marks[n & 3], n | 0, n + 1];
}

function choosesTheLargestInt32(flag) {
  let n = 0;
  n = flag ? 1 : 2147483647;
  n++;
  return [n, marks[n & 3], n | 0];
}

function choosesNaN(flag) {
  let n = 0;
  n = flag ? 1 : NaN;
  return [n, marks[n], n | 0, n === n];
}

function choosesInfinity(flag) {
  let n = 0;
  n = flag ? 1 : Infinity;
  return [n, marks[n], n | 0, n - 1];
}

function negatesZero(flag) {
  let n = 0;
  if (!flag) n = -n;
  return [n, 1 / n, marks[n]];
}

function assignsNegativeZeroLate(count) {
  let n = 0;
  for (let i = 0; i < count; i++) n = i & 3;
  if (count > 5) n = -0;
  return [n, 1 / n, marks[n]];
}

function hexAndExponentLiterals(flag) {
  let n = 0x7fffffff;
  if (flag) n = 1e3;
  else n = 0xffffffff;
  return [n, n | 0, marks[n & 3], n + 1];
}

const uses = [startsAsNegativeZero, choosesNegativeZero, choosesAFraction, choosesALargeLiteral, choosesTheLargestInt32, choosesNaN, choosesInfinity, negatesZero, hexAndExponentLiterals];
for (let i = 0; i < 2000; i++) for (const use of uses) use(true);
for (const use of uses) {
  attempt(use.name + "(true)", () => use(true));
  attempt(use.name + "(false)", () => use(false));
  attempt(use.name + "(true) again", () => use(true));
}
attempt("assignsNegativeZeroLate(3)", () => assignsNegativeZeroLate(3));
attempt("assignsNegativeZeroLate(9)", () => assignsNegativeZeroLate(9));
