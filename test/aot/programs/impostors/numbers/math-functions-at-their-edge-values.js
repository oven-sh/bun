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

function check(label, run) {
  for (let i = 0; i < 3; i++) run();
  attempt(label, run);
}

function abs(x) {
  return Math.abs(x);
}
function max(a, b) {
  return Math.max(a, b);
}
function min(a, b) {
  return Math.min(a, b);
}
function sign(x) {
  return Math.sign(x);
}
function clz32(x) {
  return Math.clz32(x);
}
function imul(a, b) {
  return Math.imul(a, b);
}
function fround(x) {
  return Math.fround(x);
}
function sqrt(x) {
  return Math.sqrt(x);
}
function hypot(a, b) {
  return Math.hypot(a, b);
}
function atan2(a, b) {
  return Math.atan2(a, b);
}

for (let i = 1; i < 2000; i++) {
  abs(i);
  max(i, 1);
  min(i, 1);
  sign(i);
  clz32(i);
  imul(i, 3);
  fround(i);
  sqrt(i * i);
  hypot(i, 0);
  atan2(i, i);
}

for (const x of [5, -5, 0, -0, -2147483648, 2147483647, -2147483649, 0.5, -0.5, NaN, -Infinity]) check("abs(" + show(x) + ")", () => abs(x));
for (const [a, b] of [[1, 2], [0, -0], [-0, 0], [-0, -0], [NaN, 1], [1, NaN], [-Infinity, Infinity], [2147483647, 2147483648], [-2147483648, -2147483649], [1, 1.5], [0.1, 0.2]]) {
  check("max(" + show(a) + ", " + show(b) + ")", () => max(a, b));
  check("min(" + show(a) + ", " + show(b) + ")", () => min(a, b));
}
check("max()", () => Math.max());
check("min()", () => Math.min());
check("max(1)", () => Math.max(1));
check("max(-0)", () => Math.max(-0));
check("max of three", () => Math.max(1, 3, 2));
check("max of three with NaN last", () => Math.max(1, 3, NaN));
check("min of a spread", () => Math.min(...[3, -0, 0]));
check("max of an empty spread", () => Math.max(...[]));
for (const x of [5, -5, 0, -0, 0.1, -0.1, NaN, Infinity, -Infinity, 5e-324]) check("sign(" + show(x) + ")", () => sign(x));
for (const x of [0, -0, 1, 2, -1, 0.5, 2147483647, 2147483648, 4294967295, 4294967296, 4294967297, NaN, Infinity, -0.5, 1e21]) check("clz32(" + show(x) + ")", () => clz32(x));
for (const [a, b] of [[3, 4], [65536, 65536], [2147483647, 2147483647], [-2147483648, -1], [4294967295, 5], [4294967297, 5], [1.9, 1.9], [-1.9, 1.9], [NaN, 5], [Infinity, 5], [0, -5], [-0, 5], [1e21, 3]]) check("imul(" + show(a) + ", " + show(b) + ")", () => imul(a, b));
for (const x of [5, 5.5, 5.05, 0.1, 16777216, 16777217, 16777219, 2147483647, -0, 1e39, -1e39, 1e-46, NaN, 3.4028235677973366e38]) check("fround(" + show(x) + ")", () => fround(x));
for (const x of [4, 2, 0, -0, -1, -4, 2147483647, 4611686014132420609, Infinity, NaN, 1e-320]) check("sqrt(" + show(x) + ")", () => sqrt(x));
for (const [a, b] of [[3, 4], [0, 0], [-0, -0], [NaN, Infinity], [Infinity, NaN], [NaN, 1], [1e200, 1e200], [-3, -4]]) check("hypot(" + show(a) + ", " + show(b) + ")", () => hypot(a, b));
check("hypot()", () => Math.hypot());
for (const [a, b] of [[0, 0], [0, -0], [-0, 0], [-0, -0], [1, 0], [-1, 0], [0, 1], [0, -1], [-0, -1], [Infinity, Infinity], [-Infinity, -Infinity], [NaN, 1]]) check("atan2(" + show(a) + ", " + show(b) + ")", () => atan2(a, b));
