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

console.log("strict:", (function () { return this === undefined; })());

const wrappers = [
  ["a number", d => d],
  ["a text", d => String(d)],
  ["an object with valueOf", d => ({ valueOf() { if (!log.includes("valueOf " + d)) log.push("valueOf " + d); return d; } })],
  ["a bigint", d => BigInt(d)],
  ["a boolean", d => d > 0],
  ["undefined", () => undefined],
  ["not a number", () => NaN],
  ["null", () => null],
  ["a symbol", () => Symbol("s")],
  ["an array of one number", d => [d]],
  ["infinity", d => d * Infinity],
  ["a fraction below one", d => d / 10],
];

let wrap = wrappers[0][1];
const compare = (a, b) => wrap(a - b);

function sorts() {
  return [3, 1, 2].sort(compare);
}
function sortsACopy() {
  return [3, 1, 2].toSorted(compare);
}
function sortsIntegers() {
  return Array.from(Int32Array.of(3, 1, 2).sort(compare));
}
function sortsInPlaceWithAnArrow() {
  return [3, 1, 2].sort((a, b) => wrap(b - a));
}

for (let i = 0; i < 2000; i++) {
  sorts();
  sortsACopy();
  sortsIntegers();
  sortsInPlaceWithAnArrow();
}
for (const [label, wrapper] of [...wrappers, wrappers[0]]) {
  wrap = wrapper;
  attempt("sort " + label, sorts);
  attempt("toSorted " + label, sortsACopy);
  attempt("typed array sort " + label, sortsIntegers);
  attempt("sort with an arrow " + label, sortsInPlaceWithAnArrow);
}
