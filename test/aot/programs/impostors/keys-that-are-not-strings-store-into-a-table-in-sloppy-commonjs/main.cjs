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

function store(object, key, value) {
  object[key] = value;
}

function describeKeys(object) {
  return Reflect.ownKeys(object).map(key => (typeof key === "symbol" ? key.toString() : JSON.stringify(key))).join(" ");
}

function count(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
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
  const object = {};
  store(object, "a", 1);
  store(object, "b", 2);
  count(object, "a");
}

const everything = {};
const withoutAPrototype = Object.create(null);
const counts = {};
for (const key of keys) {
  attempt("one store with " + key, () => {
    const object = {};
    store(object, make(key), "stored");
    return describeKeys(object) + " | prototype kept: " + (Object.getPrototypeOf(object) === Object.prototype);
  });
  attempt("into the common tables " + key, () => {
    store(everything, make(key), key);
    store(withoutAPrototype, make(key), key);
    count(counts, make(key));
    return Reflect.ownKeys(everything).length + " " + Reflect.ownKeys(withoutAPrototype).length + " " + Reflect.ownKeys(counts).length;
  });
  if (log.length) console.log("log", log.splice(0).join(", "));
}

console.log("order:", describeKeys(everything));
console.log("order without a prototype:", describeKeys(withoutAPrototype));
console.log("Object.keys:", JSON.stringify(Object.keys(everything)));
console.log("JSON:", JSON.stringify(everything));
console.log("counts:", JSON.stringify(counts));
const inOrder = [];
for (const key in everything) inOrder.push(key);
console.log("for-in:", JSON.stringify(inOrder));
console.log("the last store wins:", everything[1], "|", everything.a, "|", everything[""], "|", everything[Symbol.for("a")]);
console.log("prototype of the common table kept:", Object.getPrototypeOf(everything) === Object.prototype, Object.getPrototypeOf(withoutAPrototype) === null);
