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

function seconds(ms) {
  return [Math.floor(ms / 1000), (ms / 1000) | 0, ms % 1000, Math.floor(ms / 86400000), ms % 86400000];
}

function sumOfUnsigned(a, b) {
  const sum = (a >>> 0) + (b >>> 0);
  return [sum, sum | 0, sum >>> 0, sum % 10, sum / 2, sum > 4294967295, sum === 4294967296];
}

function productOfUnsigned(a, b) {
  const product = (a >>> 0) * (b >>> 16);
  return [product, product | 0, product % 1000, product + 1, product - 1, -product];
}

function joinHalves(high, low) {
  return (high >>> 0) * 4294967296 + (low >>> 0);
}

function splitHalves(value) {
  return [Math.floor(value / 4294967296), value % 4294967296, value >>> 0, (value / 4294967296) | 0];
}

function accumulate(step, rounds) {
  let total = 0;
  for (let i = 0; i < rounds; i++) total += step | 0;
  return [total, total | 0, total % 7];
}

function nearTheLimit(offset) {
  const limit = 9007199254740991;
  const value = limit + (offset | 0);
  return [value, value + 1, value - 1, value === value + 1, Number.isSafeInteger(value), value % 2, value | 0];
}

function compared(a, b) {
  const x = (a >>> 0) * 1024;
  const y = (b >>> 0) * 1024;
  return [x < y, x <= y, x === y, x - y, Math.max(x, y), Math.min(x, y)];
}

function kept(value) {
  const holder = { n: 0 };
  const list = [0, 1];
  holder.n = (value >>> 0) * 16;
  list[0] = (value >>> 0) * 16;
  let captured = 0;
  const set = () => {
    captured = (value >>> 0) * 16;
  };
  set();
  return [holder.n, list, captured, JSON.stringify(holder), String(holder.n), Object.keys({ [holder.n]: 1 })];
}

for (let i = 0; i < 2000; i++) {
  seconds(i * 1000);
  sumOfUnsigned(i, i);
  productOfUnsigned(i, i << 16);
  joinHalves(0, i);
  splitHalves(i);
  accumulate(i, 3);
  nearTheLimit(-i - 10);
  compared(i, i + 1);
  kept(i);
}

for (const ms of [0, 999, 1000, 1700000000123, 2147483647000, 2147483648000, 4294967296000, 8640000000000000, -1, -1000, -1700000000123, 0.5, NaN]) attempt("seconds(" + show(ms) + ")", () => seconds(ms));
for (const [a, b] of [[1, 2], [4294967295, 1], [4294967295, 4294967295], [2147483648, 2147483648], [-1, -1], [-1, 1], [2147483647, 1]]) {
  attempt("sumOfUnsigned(" + a + ", " + b + ")", () => sumOfUnsigned(a, b));
  attempt("productOfUnsigned(" + a + ", " + b + ")", () => productOfUnsigned(a, b));
  attempt("compared(" + a + ", " + b + ")", () => compared(a, b));
}
for (const [high, low] of [[0, 1], [1, 0], [1, 1], [2097151, 4294967295], [2097152, 0], [2097152, 1], [4294967295, 4294967295], [-1, -1]]) {
  attempt("joinHalves(" + high + ", " + low + ")", () => joinHalves(high, low));
  attempt("splitHalves of it", () => splitHalves(joinHalves(high, low)));
}
for (const [step, rounds] of [[1, 5], [2147483647, 3], [-2147483648, 3], [2147483647, 1000], [1000000007, 5000]]) attempt("accumulate(" + step + ", " + rounds + ")", () => accumulate(step, rounds));
for (const offset of [-2, -1, 0, 1, 2, 3, 4, 5]) attempt("nearTheLimit(" + offset + ")", () => nearTheLimit(offset));
for (const value of [1, 134217727, 134217728, 268435456, 4294967295, -1]) attempt("kept(" + value + ")", () => kept(value));
