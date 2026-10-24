import data from "./data.json";

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

function pushes(label) {
  const a = data.arrays[label];
  a.push(1);
  return a.length;
}

function iterates(label) {
  const a = data.arrays[label];
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(label) {
  const s = data.strings[label];
  return s.charCodeAt(0);
}

function truncates(label) {
  const n = data.numbers[label];
  return n | 0;
}

function addsOne(label) {
  const n = data.numbers[label];
  return n + 1;
}

function addsMembers(label) {
  const o = data.objects[label];
  return o.x + o.y;
}

function storesMember(label) {
  const o = data.objects[label];
  o.x = 1;
  return o;
}

const table = [
  ["pushes", pushes, "arrays"],
  ["iterates", iterates, "arrays"],
  ["readsCharCode", readsCharCode, "strings"],
  ["truncates", truncates, "numbers"],
  ["addsOne", addsOne, "numbers"],
  ["addsMembers", addsMembers, "objects"],
  ["storesMember", storesMember, "objects"],
];

function everyCase(round) {
  for (const [name, use, kind] of table) {
    const labels = Object.keys(data[kind]);
    for (const label of [...labels, labels[0]]) attempt(round + " " + name + " " + label, () => use(label));
  }
}

everyCase("at first");
for (let i = 0; i < 20; i++) {
  pushes("an array");
  iterates("an array");
  readsCharCode("a text");
  truncates("an integer");
  addsOne("an integer");
  addsMembers("an object");
  storesMember("an object");
}
everyCase("after 20");

function addsOneToTheInteger() {
  const n = data.numbers["an integer"];
  return n + 1;
}
function addsTheMembersOfTheObject() {
  const o = data.objects["an object"];
  return o.x + o.y;
}
attempt("the integer by its constant name", addsOneToTheInteger);
attempt("the object by its constant name", addsTheMembersOfTheObject);
data.numbers["an integer"] = "7";
Object.defineProperty(data.objects["an object"], "y", { get() { log.push("get y"); return "two"; } });
attempt("the integer after the program stored a text there", addsOneToTheInteger);
attempt("the object after the program defined a getter there", addsTheMembersOfTheObject);
data.objects["an object"] = [1, 2];
attempt("the object after the program stored an array there", addsTheMembersOfTheObject);
attempt("the keys", () => Object.keys(data).map(kind => kind + ": " + Object.keys(data[kind]).join("|")));
