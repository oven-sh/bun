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

function floors(divisor) {
  const seen = [];
  for (let i = -9; i <= 9; i++) seen.push(Math.floor(i / divisor));
  return seen;
}

function ceilings(divisor) {
  const seen = [];
  for (let i = 0; i <= 12; i++) seen.push(Math.ceil(i / divisor));
  return seen;
}

function truncations(divisor) {
  const seen = [];
  for (let i = 0; i <= 12; i++) seen.push(Math.trunc(i / divisor));
  return seen;
}

function roundings(divisor) {
  const seen = [];
  for (let i = 0; i <= 12; i++) seen.push(Math.round(i / divisor));
  return seen;
}

function toInt32(divisor) {
  const seen = [];
  for (let i = -9; i <= 9; i++) seen.push((i / divisor) | 0);
  return seen;
}

function byLiteralDivisors() {
  const seen = { floor3: [], ceil3: [], trunc3: [], round3: [], round2: [], round4: [], or3: [], orMinus3: [], unsigned3: [] };
  for (let i = 0; i <= 12; i++) {
    seen.floor3.push(Math.floor(i / 3));
    seen.ceil3.push(Math.ceil(i / 3));
    seen.trunc3.push(Math.trunc(i / 3));
    seen.round3.push(Math.round(i / 3));
    seen.round2.push(Math.round(i / 2));
    seen.round4.push(Math.round(i / 4));
    seen.or3.push((i / 3) | 0);
    seen.orMinus3.push((i / -3) | 0);
    seen.unsigned3.push((i / -3) >>> 0);
  }
  return seen;
}

function wideDividends(a, b) {
  const wide = (a | 0) * 65536;
  const unsigned = a >>> 0;
  return [(wide / (b | 0)) | 0, Math.floor(wide / 3), (unsigned / (b >>> 0)) | 0, (unsigned / (b >>> 0)) >>> 0, Math.floor(unsigned / 3), Math.round(unsigned / 2), Math.ceil(unsigned / 2), ~~(wide / 7), (wide / 1) | 0, (wide / -1) | 0];
}

function lengths(list, parts) {
  return [Math.floor(list.length / parts), Math.ceil(list.length / parts), Math.round(list.length / parts), (list.length / parts) | 0, list.length / parts];
}

function middleOf(list) {
  return [list[Math.floor(list.length / 2)], list[(list.length / 2) | 0], list[list.length >> 1], list[Math.round(list.length / 2)], list[Math.ceil(list.length / 2)]];
}

for (let i = 1; i < 500; i++) {
  floors(i);
  ceilings(i);
  truncations(i);
  roundings(i);
  toInt32(i);
  wideDividends(i, i);
  lengths([1, 2, 3], i);
  middleOf([1, 2, 3]);
}

for (const divisor of [1, 2, 3, 4, 5, 7, 100]) {
  attempt("floors(" + divisor + ")", () => floors(divisor));
  attempt("ceilings(" + divisor + ")", () => ceilings(divisor));
  attempt("truncations(" + divisor + ")", () => truncations(divisor));
  attempt("roundings(" + divisor + ")", () => roundings(divisor));
  attempt("toInt32(" + divisor + ")", () => toInt32(divisor));
}
for (const divisor of [0, -0, -1, -2, -3, 0.5, 2.5, NaN, Infinity, -Infinity, "2", null, undefined, 2n]) {
  const label = show(divisor);
  attempt("floors(" + label + ")", () => floors(divisor));
  attempt("ceilings(" + label + ")", () => ceilings(divisor));
  attempt("truncations(" + label + ")", () => truncations(divisor));
  attempt("roundings(" + label + ")", () => roundings(divisor));
  attempt("toInt32(" + label + ")", () => toInt32(divisor));
}
const literal = byLiteralDivisors();
for (const key of Object.keys(literal)) attempt("byLiteralDivisors " + key, () => literal[key]);
for (const [a, b] of [[7, 2], [2147483647, 1], [2147483647, -1], [-2147483648, -1], [-2147483648, 1], [-1, 1], [-1, 3], [65535, 0], [0, 0], [0, -1], [123456789, 1000]]) attempt("wideDividends(" + a + ", " + b + ")", () => wideDividends(a, b));
for (const parts of [1, 2, 3, 4, 0, -2, 0.5]) attempt("lengths of five by " + show(parts), () => lengths([1, 2, 3, 4, 5], parts));
attempt("lengths of none", () => lengths([], 2));
attempt("lengths of none by a negative number", () => lengths([], -2));
for (const list of [[], ["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]]) attempt("middleOf " + list.length, () => middleOf(list));
