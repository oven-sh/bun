const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

const functions = [
  ["nothing", ""],
  ["a function", "function f(x) { return 'declared by eval ' + x; }"],
  ["a generator function", "function* f(x) { yield x; }"],
  ["an async function", "async function f(x) { return x; }"],
  ["a variable without a value", "var f;"],
  ["a variable that holds a class", "var f = class Made {};"],
  ["a variable that holds a number", "var f = 5;"],
  ["a function in a block", "{ function f(x) { return 'declared in a block ' + x; } }"],
  ["a function in a branch not taken", "if (false) { function f(x) { return 'never'; } }"],
];

function calls(f, text) {
  eval(text);
  const result = f(1);
  return typeof result === "object" ? Object.prototype.toString.call(result) : result;
}

const table = [
  ["calls", calls, functions],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, text] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(x => x + 1, text));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  calls(x => x + 1, "");
}
everyCase("after 2000");
