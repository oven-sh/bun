// The four files beside this one are further entry points of the build: a load under a computed name finds a file of the executable only if it is one.
const log = (globalThis.log = []);

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

const embedded = [() => require("./honest.cjs"), () => require("./first.cjs"), () => require("./second.cjs"), () => require("./third.cjs")];
const fileOf = set => "./" + set + ".cjs";

function pushes(file) {
  const a = require(file).a();
  a.push(1);
  return a.length;
}

function iterates(file) {
  const a = require(file).a();
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(file) {
  const s = require(file).s();
  return s.charCodeAt(0);
}

function truncates(file) {
  const n = require(file).n();
  return n | 0;
}

function addsOne(file) {
  const n = require(file).n();
  return n + 1;
}

function calls(file) {
  const f = require(file).f();
  return f(1);
}

function addsMembers(file) {
  const o = require(file).o();
  return o.x + o.y;
}

function storesMember(file) {
  const o = require(file).o();
  o.x = 1;
  return o;
}

const table = [
  ["pushes", pushes],
  ["iterates", iterates],
  ["readsCharCode", readsCharCode],
  ["truncates", truncates],
  ["addsOne", addsOne],
  ["calls", calls],
  ["addsMembers", addsMembers],
  ["storesMember", storesMember],
];

function everyCase(round) {
  for (const [name, use] of table) {
    for (const set of ["honest", "first", "second", "third", "honest"]) attempt(round + " " + name + " " + set, () => use(fileOf(set)));
  }
}

console.log("embedded", embedded.length);
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes(fileOf("honest"));
  iterates(fileOf("honest"));
  readsCharCode(fileOf("honest"));
  truncates(fileOf("honest"));
  addsOne(fileOf("honest"));
  calls(fileOf("honest"));
  addsMembers(fileOf("honest"));
  storesMember(fileOf("honest"));
}
everyCase("after 2000");
