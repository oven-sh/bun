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

function readArgument(key, first, second) {
  return arguments[key];
}

function storeArgument(key, first, second) {
  arguments[key] = "stored";
  return [key === "stored" ? "the key itself" : "key kept", first, second, arguments.length, Object.keys(arguments).join(",")];
}

function removeArgument(key, first, second) {
  const answer = delete arguments[key];
  first = "changed afterwards";
  return [answer, arguments[1], arguments.length, Object.keys(arguments).join(",")];
}

function hasArgument(key, first, second) {
  return [key in arguments, Object.hasOwn(arguments, key)];
}

function sumByKeys(keysToUse) {
  const inner = function () {
    let text = "";
    for (let i = 0; i < keysToUse.length; i++) text += arguments[keysToUse[i]] + "|";
    return text;
  };
  return inner("a", "b", "c");
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
  readArgument(1, "first", "second");
  storeArgument(1, "first", "second");
  removeArgument(2, "first", "second");
  hasArgument(1, "first", "second");
  sumByKeys([0, 1, 2]);
}

function plain(found) {
  return typeof found === "function" ? "function " + found.name : found === Object.prototype ? "Object.prototype" : found;
}

for (const key of keys) {
  attempt("arguments[" + key + "]", () => {
    const given = make(key);
    const found = readArgument(given, "first", "second");
    return found === given && typeof given === "object" && given !== null ? "the key itself" : plain(found);
  });
  attempt("arguments[" + key + "] = 'stored'", () => storeArgument(make(key), "first", "second"));
  attempt("delete arguments[" + key + "]", () => removeArgument(make(key), "first", "second"));
  attempt(key + " in arguments", () => hasArgument(make(key), "first", "second"));
  if (log.length) console.log("log", log.splice(0).join(", "));
}
attempt("many kinds of keys in one loop", () => sumByKeys([0, "1", 2.0, "02", -0, "-0", 1.5, 3, "length", [1], { toString: () => "2" }]));
