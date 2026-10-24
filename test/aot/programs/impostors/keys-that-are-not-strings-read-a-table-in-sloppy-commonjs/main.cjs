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

const table = {
  a: "a",
  b: "b",
  0: "0",
  1: "1",
  1000: "1000",
  4294967294: "4294967294",
  4294967295: "4294967295",
  4294967296: "4294967296",
  2147483647: "2147483647",
  2147483648: "2147483648",
  "-0": "-0",
  "00": "00",
  "0.0": "0.0",
  "1.0": "1.0",
  "01": "01",
  " 1": " 1",
  "+1": "+1",
  "1e3": "1e3",
  "-1": "-1",
  "1.5": "1.5",
  "0.30000000000000004": "0.30000000000000004",
  "9007199254740992": "9007199254740992",
  "9007199254740993": "9007199254740993",
  "1e21": "1e21",
  "1e+21": "1e+21",
  "1e-7": "1e-7",
  NaN: "NaN",
  Infinity: "Infinity",
  "-Infinity": "-Infinity",
  null: "null",
  undefined: "undefined",
  true: "true",
  false: "false",
  "": "empty",
  "1,2": "1,2",
  "[object Object]": "[object Object]",
  "Symbol(a)": "Symbol(a)",
  [Symbol.for("a")]: "the symbol",
  length: "length",
};

function readTheTable(key) {
  return table[key];
}

function read(object, key) {
  return object[key];
}

function readOrDefault(key) {
  return table[key] || "missing";
}

function readTwice(key) {
  return table[key] === table[key];
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

let total = 0;
const honest = ["a", "b", "length", "null", "missing"];
for (let i = 0; i < 2000; i++) {
  const key = honest[i % honest.length];
  total += readOrDefault(key).length + String(readTheTable(key)).length + String(read(table, key)).length;
  if (readTwice(key)) total++;
}
console.log("2000 honest rounds", total);

for (const key of keys) {
  attempt("table[" + key + "]", () => {
    const found = readTheTable(make(key));
    return typeof found === "function" ? "function " + found.name : found === Object.prototype ? "Object.prototype" : found;
  });
  attempt("object[" + key + "]", () => {
    const found = read(table, make(key));
    return typeof found === "function" ? "function " + found.name : found === Object.prototype ? "Object.prototype" : found;
  });
  attempt("twice [" + key + "]", () => readTwice(make(key)));
  if (log.length) console.log("log", log.splice(0).join(", "));
}
attempt("honest again", () => [readTheTable("a"), read(table, "b"), readOrDefault("nothing"), readTwice("a")]);
