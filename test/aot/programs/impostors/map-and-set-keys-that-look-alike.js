function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function put(map, key, value) {
  map.set(key, value);
  return map.size;
}

function get(map, key) {
  return map.get(key);
}

function has(map, key) {
  return map.has(key);
}

function add(set, key) {
  set.add(key);
  return set.size;
}

function distinct(values) {
  return new Set(values).size;
}

const texts = [
  "'1'",
  "1",
  "1n",
  "1.0",
  "'1.0'",
  "'a'",
  "'a' + ''",
  "'xa'.slice(1)",
  "['a'].join()",
  "'a\\u4e16'.slice(0, 1)",
  "String.fromCharCode(97)",
  "new String('a')",
  "new String('a')",
  "0",
  "-0",
  "'0'",
  "'-0'",
  "NaN",
  "0 / 0",
  "'NaN'",
  "null",
  "'null'",
  "undefined",
  "'undefined'",
  "true",
  "'true'",
  "''",
  "[]",
  "[]",
  "Symbol('a')",
  "Symbol('a')",
  "Symbol.for('a')",
  "Symbol.for('a')",
  "'\\u00e9'",
  "'e\\u0301'",
  "'e\\u0301'.normalize()",
  "'\\ud83d'",
  "'\\ud83d\\ude00'[0]",
  "2 ** 53",
  "2 ** 53 + 1",
  "2n ** 53n",
  "0.1 + 0.2",
  "0.3",
  "{ toString() { return 'a'; } }",
];

const warm = new Map();
const warmSet = new Set();
let total = 0;
for (let i = 0; i < 2000; i++) {
  const key = "k" + (i % 7);
  total += put(warm, key, i) + add(warmSet, key) + get(warm, key);
  if (has(warm, key)) total++;
}
console.log("2000 honest rounds", total);

const map = new Map();
const set = new Set();
for (const text of texts) {
  attempt("set " + text, () => {
    const key = make(text);
    const before = has(map, key);
    return [before, get(map, key), put(map, key, text), add(set, key)];
  });
}
console.log("keys in order:", [...map.keys()].map(show).join(" "));
console.log("values in order:", [...map.values()].join(" | "));
console.log("set in order:", [...set].map(show).join(" "));
attempt("minus zero comes back as", () => [...new Set([-0])][0]);
attempt("minus zero as a map key comes back as", () => [...new Map([[-0, 1]]).keys()][0]);
attempt("distinct", () => [distinct(["a", "a" + "", new String("a"), new String("a")]), distinct([1, "1", 1n, 1.0]), distinct([NaN, NaN, 0, -0]), distinct("hello"), distinct([[], []])]);
attempt("delete by a look-alike", () => {
  const letters = new Map([["1", "text"], [1, "number"]]);
  return [letters.delete(1n), letters.delete("1.0"), letters.delete(1.0), [...letters.keys()]];
});
attempt("weak collections refuse texts", () => new WeakMap().set("a", 1));
attempt("weak sets refuse texts", () => new WeakSet().add("a"));
attempt("weak collections take wrapped texts", () => new WeakMap().set(new String("a"), 1).has(new String("a")));
attempt("weak collections and symbols", () => [new WeakMap().set(Symbol("a"), 1) instanceof WeakMap]);
attempt("weak collections and registered symbols", () => new WeakMap().set(Symbol.for("a"), 1));
attempt("Object.groupBy turns keys into texts", () => {
  const groups = Object.groupBy([1, "1", 1n, null, "null", -0, [1]], value => value);
  return Reflect.ownKeys(groups).map(key => key + ":" + groups[key].length);
});
attempt("Map.groupBy does not", () => [...Map.groupBy([1, "1", 1n, null, "null", -0, 0], value => value)].map(([key, values]) => show(key) + ":" + values.length));
