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

function primesBelow(n) {
  const crossedOut = new Array(n).fill(false);
  const primes = [];
  for (let candidate = 2; candidate < n; candidate++) {
    if (!crossedOut[candidate]) {
      primes.push(candidate);
      let multiple = candidate * candidate;
      while (multiple < n) {
        crossedOut[multiple] = true;
        multiple += candidate;
      }
    }
  }
  return primes;
}

function histogram(values, buckets) {
  const counts = new Array(buckets).fill(0);
  for (let i = 0; i < values.length; i++) counts[values[i]]++;
  let text = "";
  for (let i = 0; i < buckets; i++) text += counts[i] + ",";
  return text;
}

function storedValue(value) {
  const cells = new Array(4).fill(0);
  cells[1] = value;
  return [cells[0], cells[1], typeof cells[1], cells[1] + 1];
}

function storedFlag(value) {
  const flags = new Array(4).fill(false);
  flags[1] = value;
  return [flags[0], flags[1], typeof flags[1], flags[1] ? "truthy" : "falsy"];
}

function storedAt(index) {
  const cells = new Array(4).fill(0);
  cells[index] = 7;
  return [cells[0], cells[3], cells[index], cells.length];
}

function readAt(index) {
  const cells = new Array(4).fill(5);
  return [cells[index], typeof cells[index]];
}

function accumulated(step) {
  const cells = new Array(2).fill(0);
  for (let i = 0; i < 4; i++) cells[0] += step;
  return [cells[0], cells[1]];
}

function incrementedFrom(start) {
  const cells = new Array(2).fill(start);
  cells[0]++;
  cells[0]++;
  cells[1]--;
  return [cells[0], cells[1]];
}

function withoutFill(n) {
  const cells = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) total += cells[i];
  return [total, cells.length, 0 in cells];
}

function filledWith(value) {
  const cells = new Array(3).fill(value);
  return [cells[0], cells[2], Object.is(cells[0], value), cells[0] + cells[1]];
}

function lengthOf(n) {
  const cells = new Array(n).fill(0);
  return cells.length;
}

for (let i = 0; i < 300; i++) {
  primesBelow(30);
  histogram([1, 2, 2, 3], 5);
  storedValue(i);
  storedFlag(i % 2 === 0);
  storedAt(i & 3);
  readAt(i & 3);
  accumulated(1);
  incrementedFrom(i);
  withoutFill(2);
  filledWith(i);
  lengthOf(3);
}

attempt("primesBelow(30)", () => primesBelow(30));
for (const n of [0, 1, 2, 2.5, -1, NaN, "10", null, undefined, 4294967296, 10n, [10], true]) attempt("primesBelow(" + show(n) + ")", () => primesBelow(n));
attempt("histogram in range", () => histogram([0, 1, 1, 4], 5));
attempt("histogram past the end", () => histogram([0, 5, 9], 5));
attempt("histogram below zero", () => histogram([0, -1], 5));
attempt("histogram of fractions", () => histogram([0, 1.5, 1.0], 5));
attempt("histogram of texts", () => histogram(["0", "1", "x", "length"], 5));
attempt("histogram of nothing", () => histogram([undefined, null, NaN], 5));
const values = [1, 127, 128, 255, 256, 65536, 2147483647, 2147483648, -1, -2147483648, -2147483649, 0.5, -0, NaN, Infinity, "1", "", null, undefined, true, false, 1n, [1], {}];
for (const value of values) {
  attempt("storedValue(" + show(value) + ")", () => storedValue(value));
  attempt("storedFlag(" + show(value) + ")", () => storedFlag(value));
  attempt("filledWith(" + show(value) + ")", () => filledWith(value));
  attempt("accumulated(" + show(value) + ")", () => accumulated(value));
  attempt("incrementedFrom(" + show(value) + ")", () => incrementedFrom(value));
}
for (const index of [0, 3, 4, 10, -1, 1.5, -0, NaN, "1", "01", "length", null, undefined, 4294967294, 4294967295, 1n]) {
  attempt("storedAt(" + show(index) + ")", () => storedAt(index));
  attempt("readAt(" + show(index) + ")", () => readAt(index));
}
for (const n of [0, 3, 2.5, -1, "3", NaN, null, undefined, true, [3], 4294967296]) {
  attempt("withoutFill(" + show(n) + ")", () => withoutFill(n));
  attempt("lengthOf(" + show(n) + ")", () => lengthOf(n));
}
