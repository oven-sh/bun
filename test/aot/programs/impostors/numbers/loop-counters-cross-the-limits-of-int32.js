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

function upwards(from, to) {
  const seen = [];
  for (let i = from; i < to; i++) seen.push(i);
  return seen;
}

function upwardsInclusive(from, to) {
  const seen = [];
  for (let i = from; i <= to; i++) {
    seen.push(i);
    if (seen.length > 8) break;
  }
  return seen;
}

function downwards(from, to) {
  const seen = [];
  for (let i = from; i > to; i--) seen.push(i);
  return seen;
}

function downwardsInclusive(from, to) {
  const seen = [];
  for (let i = from; i >= to; i--) {
    seen.push(i);
    if (seen.length > 8) break;
  }
  return seen;
}

function byStep(from, to, step) {
  const seen = [];
  for (let i = from; i < to; i += step) seen.push(i);
  return seen;
}

function summed(from, to) {
  let total = 0;
  for (let i = from; i < to; i++) total += i;
  return total;
}

function summedAsInt32(from, to) {
  let total = 0;
  for (let i = from; i < to; i++) total = (total + i) | 0;
  return total;
}

function doubling(limit) {
  const seen = [];
  for (let i = 1; i < limit; i *= 2) if (i > 500000000) seen.push(i);
  return seen;
}

function doublingByAShift() {
  const seen = [];
  for (let i = 1; i > 0; i <<= 1) if (i > 100000000) seen.push(i);
  return seen;
}

function indexedWhileCrossing(from, to) {
  const sparse = [];
  for (let i = from; i < to; i++) sparse[i] = i;
  return [sparse.length, Object.keys(sparse)];
}

function twoCounters(from, count) {
  const seen = [];
  for (let i = 0, j = from; i < count; i++, j++) seen.push(j - i, j + i);
  return seen;
}

for (let i = 0; i < 500; i++) {
  upwards(i, i + 3);
  upwardsInclusive(i, i + 3);
  downwards(i + 3, i);
  downwardsInclusive(i + 3, i);
  byStep(i, i + 9, 3);
  summed(i, i + 3);
  summedAsInt32(i, i + 3);
  indexedWhileCrossing(i, i + 3);
  twoCounters(i, 3);
}

attempt("upwards across 2 ** 31", () => upwards(2147483645, 2147483651));
attempt("upwards to the largest int32", () => upwards(2147483645, 2147483647));
attempt("upwardsInclusive to the largest int32", () => upwardsInclusive(2147483645, 2147483647));
attempt("upwards across 2 ** 32", () => upwards(4294967293, 4294967299));
attempt("upwards across zero", () => upwards(-2, 3));
attempt("upwards across 2 ** 53", () => upwardsInclusive(9007199254740990, 9007199254740992).length);
attempt("downwards across -(2 ** 31)", () => downwards(-2147483645, -2147483651));
attempt("downwardsInclusive to the smallest int32", () => downwardsInclusive(-2147483645, -2147483648));
attempt("downwardsInclusive to zero", () => downwardsInclusive(3, 0));
attempt("byStep of 2 ** 30", () => byStep(0, 5000000000, 1073741824));
attempt("byStep of the largest int32", () => byStep(1, 9000000000, 2147483647));
attempt("byStep of a half", () => byStep(0, 2, 0.5));
attempt("byStep of a tenth", () => byStep(0, 0.5, 0.1));
attempt("byStep from a negative int32", () => byStep(-2147483648, 2147483648, 1073741824));
attempt("summed near the largest int32", () => summed(2147483640, 2147483650));
attempt("summed from 0 to 70000", () => summed(0, 70000));
attempt("summedAsInt32 from 0 to 70000", () => summedAsInt32(0, 70000));
attempt("summedAsInt32 near the largest int32", () => summedAsInt32(2147483640, 2147483650));
attempt("doubling up to 2 ** 34", () => doubling(17179869184));
attempt("doublingByAShift", () => doublingByAShift());
attempt("indexedWhileCrossing 2 ** 31", () => indexedWhileCrossing(2147483646, 2147483650));
attempt("indexedWhileCrossing 2 ** 32", () => indexedWhileCrossing(4294967293, 4294967298));
attempt("twoCounters near the largest int32", () => twoCounters(2147483646, 4));
