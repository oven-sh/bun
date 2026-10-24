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

function isBeforeM(value) {
  return value < "m";
}

function isAfterM(value) {
  return value > "m";
}

function isAtMostTen(value) {
  return value <= "10";
}

function isAtLeastTen(value) {
  return value >= "10";
}

function tenIsBefore(value) {
  return "10" < value;
}

function isALowerCaseLetter(value) {
  return value >= "a" && value <= "z";
}

function isADigit(value) {
  return "0" <= value && value <= "9";
}

function countBeforeM(values) {
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < "m") count++;
  }
  return count;
}

const log = [];
globalThis.log = log;

const values = [
  "'a'",
  "'m'",
  "'z'",
  "'M'",
  "''",
  "'10'",
  "'9'",
  "'09'",
  "'100'",
  "'1e1'",
  "' 10 '",
  "'\\u00e9'",
  "'\\uffff'",
  "'\\ud800\\udc00'",
  "'ma'",
  "9",
  "10",
  "11",
  "-0",
  "NaN",
  "Infinity",
  "9n",
  "10n",
  "11n",
  "true",
  "false",
  "null",
  "undefined",
  "Symbol('a')",
  "new String('a')",
  "new String('9')",
  "new Number(9)",
  "['a']",
  "[9]",
  "[]",
  "[1, 0]",
  "{}",
  "{ valueOf() { log.push('valueOf'); return 'a'; }, toString() { log.push('toString'); return 'z'; } }",
  "{ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return 'z'; } }",
  "{ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '9'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'a'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 9n; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return Symbol('a'); } }",
  "new Date(9)",
  "Buffer.from('a')",
  "new Uint8Array([9])",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  const honest = "akz05"[i % 5];
  if (isBeforeM(honest)) total++;
  if (isAfterM(honest)) total += 2;
  if (isAtMostTen(honest)) total += 3;
  if (isAtLeastTen(honest)) total += 5;
  if (tenIsBefore(honest)) total += 7;
  if (isALowerCaseLetter(honest)) total += 11;
  if (isADigit(honest)) total += 13;
  total += countBeforeM(["a", "z", honest]);
}
console.log("2000 honest rounds", total);

for (const text of values) {
  attempt(text, () => {
    const value = make(text);
    return [isBeforeM(value), isAfterM(value), isAtMostTen(value), isAtLeastTen(value), tenIsBefore(value), isALowerCaseLetter(value), isADigit(value)].join(" ");
  });
  if (log.length) console.log("log", log.splice(0).join(", "));
  attempt("counted among strings " + text, () => countBeforeM(["a", make(text), "z", make(text)]));
  log.length = 0;
}

console.log("bytes made in plain sight", Buffer.from("he").length);
