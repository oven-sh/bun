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

const letters = ["a", "b", "c", "d"];

function index(n) {
  return letters[n];
}

function truncated(n) {
  return n | 0;
}

function incremented(n) {
  n++;
  return n;
}

function doubled(n) {
  return n * 2;
}

function plusOne(n) {
  return n + 1;
}

function inverted(n) {
  return 1 / n;
}

function isSmall(n) {
  return n < 10;
}

function text(n) {
  return String(n);
}

const uses = [index, truncated, incremented, doubled, plusOne, inverted, isSmall, text];
const texts = ["1", "1.0", "1.5", "-0", "-0.0", "0", "0e5", "-0e5", "1e0", "1E2", "1e400", "-1e400", "1e-400", "-1e-400", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993", "123456789012345678901234567890", "0.1", "1e21", "1e-7", "5e-324", "1.7976931348623157e308", "1.7976931348623159e308", "\"1\"", "null", "true", "[1]", "{\"valueOf\":1}"];

for (let i = 0; i < 2000; i++) for (const use of uses) use(JSON.parse(String(i & 3)));
for (const source of texts) for (const use of uses) attempt(use.name + " of JSON " + source, () => use(JSON.parse(source)));

function total(source) {
  const { items } = JSON.parse(source);
  let sum = 0;
  let bits = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].count;
    bits |= items[i].count;
  }
  return [sum, bits];
}

for (let i = 0; i < 500; i++) total('{"items":[{"count":1},{"count":2}]}');
for (const counts of [["1", "2"], ["1", "2.5"], ["1", "\"2\""], ["1", "null"], ["2147483647", "1"], ["1", "-0"], ["-0", "-0"], ["1", "1e400"], ["1", "[2]"], ["1", "{}"], ["1", "true"]]) {
  attempt("total of " + counts.join(" and "), () => total('{"items":[{"count":' + counts[0] + '},{"count":' + counts[1] + "}]}"));
}
attempt("total with a missing count", () => total('{"items":[{"count":1},{}]}'));
attempt("bad numbers", () => ["01", "1.", ".5", "+1", "0x10", "NaN", "Infinity", "-", "1e", "1_000"].map(source => outcome(() => JSON.parse(source))));
