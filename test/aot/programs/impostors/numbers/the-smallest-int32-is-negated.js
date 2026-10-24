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

function negated(value) {
  return -(value | 0);
}

function negatedTruncated(value) {
  return -(value | 0) | 0;
}

function absolute(value) {
  return Math.abs(value | 0);
}

function absoluteTruncated(value) {
  return Math.abs(value | 0) | 0;
}

function absoluteByHand(value) {
  const n = value | 0;
  return n < 0 ? -n : n;
}

function zeroMinus(value) {
  return 0 - (value | 0);
}

function timesMinusOne(value) {
  return (value | 0) * -1;
}

function dividedByMinusOne(value) {
  return (value | 0) / -1;
}

function dividedByMinusOneTruncated(value) {
  return ((value | 0) / -1) | 0;
}

function remainderByMinusOne(value) {
  return (value | 0) % -1;
}

function negatedInPlace(value) {
  let n = value | 0;
  n = -n;
  return [n, n - 1, n | 0];
}

function complementPlusOne(value) {
  return ~(value | 0) + 1;
}

const uses = [negated, negatedTruncated, absolute, absoluteTruncated, absoluteByHand, zeroMinus, timesMinusOne, dividedByMinusOne, dividedByMinusOneTruncated, remainderByMinusOne, negatedInPlace, complementPlusOne];
for (let i = 1; i < 2000; i++) for (const use of uses) use(i);
for (const use of uses) for (const value of [5, -5, 0, -2147483648, 2147483647, -2147483647, 1, -1]) attempt(use.name + "(" + value + ")", () => use(value));
