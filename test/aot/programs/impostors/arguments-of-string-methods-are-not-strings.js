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

const text = "a1,2b null undefined true [object Object] NaN 0 12";

function position(piece) {
  return text.indexOf(piece);
}

function lastPosition(piece) {
  return text.lastIndexOf(piece);
}

function contains(piece) {
  return text.includes(piece);
}

function starts(piece) {
  return text.startsWith(piece);
}

function ends(piece) {
  return text.endsWith(piece);
}

function pieces(separator) {
  return text.split(separator).length;
}

function replaced(piece) {
  return text.replace(piece, "_").length;
}

function replacedEverywhere(piece) {
  return text.replaceAll(piece, "_").length;
}

function joined(piece) {
  return "<".concat(piece, ">");
}

function padded(piece) {
  return "x".padStart(5, piece);
}

function compared(piece) {
  return "12".localeCompare(piece);
}

function matched(piece) {
  const found = text.match(piece);
  return found && found[0];
}

function searched(piece) {
  return text.search(piece);
}

const uses = [
  ["indexOf", position],
  ["lastIndexOf", lastPosition],
  ["includes", contains],
  ["startsWith", starts],
  ["endsWith", ends],
  ["split", pieces],
  ["replace", replaced],
  ["replaceAll", replacedEverywhere],
  ["concat", joined],
  ["padStart", padded],
  ["localeCompare", compared],
  ["match", matched],
  ["search", searched],
];

const log = [];
globalThis.log = log;

const values = [
  "'1'",
  "''",
  "1",
  "12",
  "-0",
  "NaN",
  "1n",
  "true",
  "null",
  "undefined",
  "[]",
  "[1, 2]",
  "[[1], [2]]",
  "{}",
  "new String('1')",
  "new Number(12)",
  "{ toString() { log.push('toString'); return '1'; }, valueOf() { log.push('valueOf'); return '2'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return '1'; } }",
  "Symbol('1')",
  "/1/",
  "/1/g",
  "/\\d/y",
  "Object.assign(/1/, { [Symbol.match]: false })",
  "{ [Symbol.match]: true, toString() { return '1'; } }",
  "{ [Symbol.match]: 0, toString() { return '1'; } }",
  "Buffer.from('1')",
  "new Uint8Array([1, 2])",
  "function named() {}.name",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("1")).length;
}
console.log("2000 honest rounds", total);

function outcome(use, source) {
  try {
    return show(use(make(source)));
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const source of values) {
  for (let from = 0; from < uses.length; from += 5) {
    console.log(source + " -> " + uses.slice(from, from + 5).map(([name, use]) => name + " " + outcome(use, source)).join("; "));
  }
  if (log.length) console.log("log", log.splice(0).join(", "));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
