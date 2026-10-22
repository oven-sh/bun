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

function joined(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) text += list[i];
  return text;
}

function joinedWithCommas(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) {
    if (i) text += ",";
    text += list[i];
  }
  return text;
}

function templated(list) {
  let text = "";
  for (const value of list) text = `${text}[${value}]`;
  return text;
}

function counted(from, to) {
  let text = "";
  for (let i = from; i < to; i++) text += i;
  return text;
}

function countedWithArithmetic(from, to) {
  let text = "";
  for (let i = from; i < to; i++) text += i * 0.5 + ";";
  return text;
}

function numberFirst(list) {
  let text = 0;
  for (let i = 0; i < list.length; i++) text += list[i];
  return text;
}

function prefixed(value) {
  return "n" + value;
}

function suffixed(value) {
  return value + "n";
}

function between(a, b) {
  return a + "" + b;
}

function sumThenText(a, b) {
  return a + b + "!";
}

function textThenSum(a, b) {
  return "!" + a + b;
}

for (let i = 0; i < 2000; i++) {
  joined([i, 1, 2]);
  joinedWithCommas([i, 1, 2]);
  templated([i, 1]);
  counted(i, i + 3);
  countedWithArithmetic(i, i + 2);
  numberFirst([i, 1]);
  prefixed(i);
  suffixed(i);
  between(i, i);
  sumThenText(i, 1);
  textThenSum(i, 1);
}

const values = [5, -5, 0, -0, 0.5, 1e21, 1e-7, 123456789012345680000, 2147483648, -2147483649, NaN, Infinity, -Infinity, "t", "", null, undefined, true, 5n, [1, 2], [], {}, { toString: () => "S", valueOf: () => "V" }, { [Symbol.toPrimitive]: hint => hint }, new Date(NaN), Symbol("s"), Object.create(null)];
for (const value of values) {
  const label = outcome(() => value);
  attempt("joined with " + label, () => joined([1, value, 2]));
  attempt("joinedWithCommas with " + label, () => joinedWithCommas([1, value, 2]));
  attempt("templated with " + label, () => templated([1, value]));
  attempt("numberFirst with " + label, () => numberFirst([1, value, 2]));
  attempt("prefixed " + label, () => prefixed(value));
  attempt("suffixed " + label, () => suffixed(value));
  attempt("between 1 and " + label, () => between(1, value));
  attempt("sumThenText of 1 and " + label, () => sumThenText(1, value));
  attempt("textThenSum of 1 and " + label, () => textThenSum(1, value));
}
attempt("counted across zero", () => counted(-2, 3));
attempt("counted across 2 ** 31", () => counted(2147483646, 2147483650));
attempt("counted from a fraction", () => counted(0.5, 3));
attempt("counted from a text", () => counted("1", 3));
attempt("counted from a bigint", () => counted(1n, 3));
attempt("countedWithArithmetic across zero", () => countedWithArithmetic(-2, 3));
