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

function after(list, i) {
  return list[i + 1];
}

function before(list, i) {
  return list[i - 1];
}

function twice(list, i) {
  return [list[i * 2], list[i << 1], list[i + i]];
}

function afterInt32(list, i) {
  return list[(i | 0) + 1];
}

function beforeInt32(list, i) {
  return list[(i | 0) - 1];
}

function storedAfter(list, i) {
  list[i + 1] = "stored";
  return [list.length, Object.keys(list).slice(-2)];
}

function offset(list, base, delta) {
  return list[base + delta];
}

function codeAfter(text, i) {
  return [text.charCodeAt(i + 1), text[i + 1], text.charAt(i + 1)];
}

function negated(list, i) {
  return list[-i];
}

function sparse() {
  const list = ["zero", "one", "two"];
  list[2147483647] = "at the largest int32";
  list[2147483648] = "at 2 ** 31";
  list[4294967294] = "at the largest index";
  list[4294967295] = "past the largest index";
  list[4294967296] = "at 2 ** 32";
  list[-1] = "at minus one";
  list[-2147483648] = "at the smallest int32";
  list[-2147483649] = "below the smallest int32";
  return list;
}

const small = ["a", "b", "c", "d"];
for (let i = 0; i < 2000; i++) {
  after(small, i & 1);
  before(small, 1 + (i & 1));
  twice(small, i & 1);
  afterInt32(small, i & 1);
  beforeInt32(small, 1 + (i & 1));
  storedAfter([1, 2], i & 1);
  offset(small, i & 1, 1);
  codeAfter("abcd", i & 1);
  negated(small, 0);
}

const list = sparse();
for (const i of [0, 1, -1, 2147483646, 2147483647, 2147483648, 4294967293, 4294967294, 4294967295, -2147483647, -2147483648, 1073741824, -1073741824, 2147483647.5, -0]) {
  attempt("after(" + show(i) + ")", () => after(list, i));
  attempt("before(" + show(i) + ")", () => before(list, i));
  attempt("twice(" + show(i) + ")", () => twice(list, i));
  attempt("afterInt32(" + show(i) + ")", () => afterInt32(list, i));
  attempt("beforeInt32(" + show(i) + ")", () => beforeInt32(list, i));
  attempt("negated(" + show(i) + ")", () => negated(list, i));
  attempt("codeAfter(" + show(i) + ")", () => codeAfter("abcd", i));
  attempt("typed after(" + show(i) + ")", () => after(new Uint8Array([1, 2, 3]), i));
}
for (const i of [1, 2147483646, 2147483647, 4294967293, 4294967294, -2, -1]) attempt("storedAfter(" + i + ")", () => storedAfter([1, 2], i));
for (const [base, delta] of [[1, 1], [2147483647, 1], [2147483647, 2147483647], [-2147483648, -1], [1073741824, 1073741824], [2147483647, -2147483647], [4294967295, -4294967295], [0.5, 0.5], [0.1, 0.2], ["1", 1], [1, "1"]]) attempt("offset(" + show(base) + ", " + show(delta) + ")", () => offset(list, base, delta));
