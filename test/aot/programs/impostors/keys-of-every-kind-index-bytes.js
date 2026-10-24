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

const inherited = {
  a: "inherited a",
  5: "inherited 5",
  "-0": "inherited -0",
  "-1": "inherited -1",
  "1.5": "inherited 1.5",
  "00": "inherited 00",
  "01": "inherited 01",
  "1.0": "inherited 1.0",
  "1e3": "inherited 1e3",
  1000: "inherited 1000",
  "1e21": "inherited 1e21",
  "1e+21": "inherited 1e+21",
  "1e-7": "inherited 1e-7",
  NaN: "inherited NaN",
  Infinity: "inherited Infinity",
  "-Infinity": "inherited -Infinity",
  4294967295: "inherited 4294967295",
  null: "inherited null",
  "": "inherited empty",
  __proto__: Uint8Array.prototype,
};

function makeBytes() {
  return Object.setPrototypeOf(new Uint8Array([10, 11, 12]), inherited);
}

function read(bytes, key) {
  return bytes[key];
}

function store(bytes, key, value) {
  bytes[key] = value;
}

function isIn(bytes, key) {
  return key in bytes;
}

function remove(bytes, key) {
  return delete bytes[key];
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
const honest = new Uint8Array([1, 2, 3]);
for (let i = 0; i < 2000; i++) {
  total += read(honest, i % 3);
  store(honest, i % 3, i);
  if (isIn(honest, i % 4)) total++;
}
console.log("2000 honest rounds", total);

function plain(found) {
  return typeof found === "function" ? "function " + found.name : typeof found === "object" && found !== null ? "an object" : found;
}

for (const key of keys) {
  attempt("bytes[" + key + "]", () => plain(read(makeBytes(), make(key))));
  attempt(key + " in bytes", () => isIn(makeBytes(), make(key)));
  attempt("bytes[" + key + "] = 77", () => {
    const bytes = makeBytes();
    store(bytes, make(key), 77);
    return Array.prototype.join.call(bytes) + " own: " + Reflect.ownKeys(bytes).map(String).join(" ");
  });
  attempt("delete bytes[" + key + "]", () => remove(makeBytes(), make(key)));
  if (log.length) console.log("log", log.splice(0).join(", "));
}
attempt("the stored value is converted even when the index is outside", () => {
  const order = [];
  store(makeBytes(), 99, { valueOf() { order.push("valueOf"); return 1; } });
  store(makeBytes(), "-0", { valueOf() { order.push("valueOf for -0"); return 1; } });
  store(makeBytes(), "1.5", { valueOf() { order.push("valueOf for 1.5"); return 1; } });
  store(makeBytes(), "01", { valueOf() { order.push("valueOf for 01"); return 1; } });
  return order;
});
