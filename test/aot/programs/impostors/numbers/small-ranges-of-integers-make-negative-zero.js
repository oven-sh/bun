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

function products() {
  const seen = [];
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) seen.push(i * j);
  return seen;
}

function productsWithAConstant() {
  const seen = [];
  for (let i = -2; i <= 2; i++) seen.push(i * 0, 0 * i, i * -0, i * -1, -1 * i);
  return seen;
}

function remainders() {
  const seen = [];
  for (let i = -6; i <= 6; i++) seen.push(i % 3);
  return seen;
}

function remaindersByAPowerOfTwo() {
  const seen = [];
  for (let i = -4; i <= 4; i++) seen.push(i % 2, i % 4);
  return seen;
}

function remaindersByANegativeNumber() {
  const seen = [];
  for (let i = -3; i <= 3; i++) seen.push(i % -3);
  return seen;
}

function negations() {
  const seen = [];
  for (let i = -1; i <= 1; i++) seen.push(-i, 0 - i, -(-i), -Math.abs(i), -(i * i));
  return seen;
}

function negatedLengths() {
  const seen = [];
  for (const list of [[], [1], [1, 2]]) seen.push(-list.length, 0 - list.length, -list.length | 0, list.length * -1);
  for (const text of ["", "a"]) seen.push(-text.length, text.length * -1);
  return seen;
}

function negatedBits() {
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(-(i & 1), -(i >> 1), -(i >>> 1), -(i | 0), -~~i);
  return seen;
}

function negatedComparisons() {
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(-(i > 1), -(i === 0), +(i > 1), (i > 1) * -1);
  return seen;
}

function minimumsAndMaximums() {
  const seen = [];
  for (let i = -1; i <= 1; i++) seen.push(Math.min(-i, 0), Math.max(-i, 0), Math.min(0, -i), Math.max(0, -i), Math.min(i * 0, 0), Math.max(i * 0, -0));
  return seen;
}

function countdownTimesSign(sign) {
  const seen = [];
  for (let i = 2; i >= 0; i--) seen.push(i * sign);
  return seen;
}

function accumulatedProduct() {
  let product = 1;
  const seen = [];
  for (let i = 2; i >= -2; i--) {
    product *= i;
    seen.push(product);
  }
  return seen;
}

function sumsKeepTheSignOnlyOfTwoNegativeZeros() {
  const seen = [];
  for (let i = -1; i <= 1; i++) seen.push(i * 0 + 0, i * 0 + i * 0, i * 0 - 0, 0 - i * 0, i * 0 + -0);
  return seen;
}

function storedInAnArrayOfIntegers() {
  const list = [1, 2, 3, 4, 5];
  for (let i = -2; i <= 2; i++) list[i + 2] = i * 0;
  return list;
}

function storedInAField() {
  const holder = { n: 1 };
  const seen = [];
  for (let i = -1; i <= 1; i++) {
    holder.n = i * 0;
    seen.push(holder.n, 1 / holder.n);
  }
  return seen;
}

const uses = [products, productsWithAConstant, remainders, remaindersByAPowerOfTwo, remaindersByANegativeNumber, negations, negatedLengths, negatedBits, negatedComparisons, minimumsAndMaximums, accumulatedProduct, sumsKeepTheSignOnlyOfTwoNegativeZeros, storedInAnArrayOfIntegers, storedInAField];
for (const round of ["first", "second"]) for (const use of uses) attempt(round + " " + use.name, use);
attempt("countdownTimesSign(1)", () => countdownTimesSign(1));
attempt("countdownTimesSign(-1)", () => countdownTimesSign(-1));
attempt("countdownTimesSign(0)", () => countdownTimesSign(0));
attempt("countdownTimesSign(-0)", () => countdownTimesSign(-0));
