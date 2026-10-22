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

function makeTable() {
  return { a: "a", 1: "1", "-0": "-0", 0: "0", null: "null", undefined: "undefined", "": "empty", "1,2": "1,2", "[object Object]": "object", 1000: "1000", "1e3": "1e3", NaN: "NaN", [Symbol.for("a")]: "symbol" };
}

function get(key) {
  return Reflect.get(makeTable(), key);
}

function has(key) {
  return Reflect.has(makeTable(), key);
}

function set(key) {
  const table = {};
  Reflect.set(table, key, 1);
  return Reflect.ownKeys(table).map(name => typeof name + " " + String(name));
}

function remove(key) {
  const table = makeTable();
  const before = Reflect.ownKeys(table).length;
  return [Reflect.deleteProperty(table, key), before - Reflect.ownKeys(table).length];
}

function define(key) {
  return Reflect.ownKeys(Object.defineProperty({}, key, { value: 1 })).map(name => typeof name + " " + String(name));
}

function describe(key) {
  const found = Reflect.getOwnPropertyDescriptor(makeTable(), key);
  return found && found.value;
}

function fromEntries(key) {
  return Reflect.ownKeys(Object.fromEntries([[key, 1]])).map(name => typeof name + " " + String(name));
}

function lookUpGetter(key) {
  const table = {};
  table.__defineGetter__(key, () => "got");
  return [Reflect.ownKeys(table).map(name => typeof name + " " + String(name)), typeof table.__lookupGetter__(key)];
}

const log = [];
globalThis.log = log;

const keys = [
  "'a'",
  "'a' + ''",
  "'xa'.slice(1)",
  "0",
  "'0'",
  "-0",
  "'-0'",
  "'00'",
  "'0.0'",
  "1",
  "'1'",
  "1.0",
  "'1.0'",
  "'01'",
  "' 1'",
  "'+1'",
  "1e3",
  "'1e3'",
  "'1000'",
  "2",
  "5",
  "-1",
  "'-1'",
  "1.5",
  "'1.5'",
  "0.1 + 0.2",
  "2147483647",
  "2147483648",
  "4294967294",
  "'4294967294'",
  "4294967295",
  "'4294967295'",
  "4294967296",
  "9007199254740993",
  "1e21",
  "'1e21'",
  "'1e+21'",
  "1e-7",
  "'1e-7'",
  "NaN",
  "'NaN'",
  "Infinity",
  "'Infinity'",
  "-Infinity",
  "null",
  "'null'",
  "undefined",
  "'undefined'",
  "true",
  "false",
  "''",
  "1n",
  "-1n",
  "[]",
  "[1]",
  "['a']",
  "[1, 2]",
  "[[]]",
  "{}",
  "new String('a')",
  "new String('1')",
  "new Number(1)",
  "Symbol.for('a')",
  "Symbol('a')",
  "'Symbol(a)'",
  "Object(Symbol.for('a'))",
  "'length'",
  "'constructor'",
  "'__proto__'",
  "'prototype'",
  "'toString'",
  "'hasOwnProperty'",
  "{ toString() { log.push('toString'); return 'a'; }, valueOf() { log.push('valueOf'); return 'b'; } }",
  "{ toString() { log.push('toString'); return 1; } }",
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return 1; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'a'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return Symbol.for('a'); } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }",
  "{ toString() { throw new RangeError('no'); } }",
  "Object.create(null)",
];

for (let i = 0; i < 2000; i++) {
  get("a");
  has("a");
  set("a");
  remove("a");
  define("a");
  describe("a");
  fromEntries("a");
}

const uses = [
  ["get", get],
  ["has", has],
  ["set", set],
  ["delete", remove],
  ["define", define],
  ["describe", describe],
  ["fromEntries", fromEntries],
  ["getter", lookUpGetter],
];

function outcome(use, text) {
  try {
    const result = use(make(text));
    return typeof result === "function" ? "function " + result.name : result === Object.prototype ? "Object.prototype" : show(result);
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const key of keys) {
  for (let from = 0; from < uses.length; from += 4) {
    console.log(key + " -> " + uses.slice(from, from + 4).map(([name, use]) => name + " " + outcome(use, key)).join("; "));
  }
  if (log.length) console.log("log", log.splice(0).join(", "));
}
