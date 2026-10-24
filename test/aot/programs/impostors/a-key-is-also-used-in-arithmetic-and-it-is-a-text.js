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

const list = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const table = { 0: "t0", 1: "t1", 2: "t2", 3: "t3", 11: "t11", 12: "t12", 21: "t21", "1.5": "t1.5", "-1": "t-1", "01": "t01", 10: "t10", NaN: "tNaN", "1x": "t1x" };

function next(values, index) {
  return values[index + 1];
}

function previous(values, index) {
  return values[index - 1];
}

function hereAndNext(values, index) {
  return [values[index], values[index + 1]];
}

function doubled(values, index) {
  return [values[index], values[index * 2]];
}

function masked(values, index) {
  return [values[index], values[index | 0], values[index >>> 0]];
}

function stepped(values, index) {
  const seen = [];
  for (let i = index; i < 3; i++) seen.push(values[i]);
  return seen;
}

function steppedByAdding(values, index) {
  const seen = [];
  for (let i = index, rounds = 0; rounds < 3; i += 1, rounds++) seen.push(values[i]);
  return seen;
}

function incrementedThenRead(values, index) {
  index++;
  return [index, values[index]];
}

function readThenIncremented(values, index) {
  return [values[index++], index];
}

function comparedThenRead(values, index) {
  return index < values.length ? values[index] : "outside";
}

function middle(values, low, high) {
  return values[(low + high) >> 1];
}

function middleByDivision(values, low, high) {
  return values[(low + high) / 2];
}

const uses = [
  ["next", next],
  ["previous", previous],
  ["here and next", hereAndNext],
  ["doubled", doubled],
  ["masked", masked],
  ["stepped", stepped],
  ["stepped by adding", steppedByAdding],
  ["incremented then read", incrementedThenRead],
  ["read then incremented", readThenIncremented],
  ["compared then read", comparedThenRead],
  ["middle with 3", (values, index) => middle(values, index, 3)],
  ["middle by division with 3", (values, index) => middleByDivision(values, index, 3)],
];

const indexes = ["1", "'1'", "'01'", "' 1'", "'1x'", "1.5", "'1.5'", "-1", "'-1'", "-0", "'-0'", "0", "'0'", "''", "NaN", "null", "undefined", "true", "[1]", "[]", "1n", "new Number(1)", "new String('1')", "{ valueOf() { return 1; }, toString() { return '2'; } }", "{ [Symbol.toPrimitive](hint) { return hint === 'string' ? '2' : 1; } }", "Symbol('1')", "2147483647", "4294967295", "4294967297", "1e21"];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(list, i % 3)).length;
}
console.log("2000 honest rounds", total);

function outcome(use, values, text) {
  try {
    return show(use(values, make(text)));
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const text of indexes) {
  for (let from = 0; from < uses.length; from += 4) {
    console.log("list, " + text + " -> " + uses.slice(from, from + 4).map(([name, use]) => name + " " + outcome(use, list, text)).join("; "));
  }
  for (let from = 0; from < uses.length; from += 4) {
    console.log("table, " + text + " -> " + uses.slice(from, from + 4).map(([name, use]) => name + " " + outcome(use, table, text)).join("; "));
  }
  console.log("text, " + text + " -> " + uses.slice(0, 5).map(([name, use]) => name + " " + outcome(use, "abcdefghijklm", text)).join("; "));
}
