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

function truncates(name) {
  const n = process.env[name];
  return n | 0;
}
function addsOne(name) {
  const n = process.env[name];
  return n + 1;
}
function readsCharCode(name) {
  const s = process.env[name];
  return s.charCodeAt(0);
}
function iterates(name) {
  const seen = [];
  for (const x of process.env[name]) seen.push(x);
  return seen;
}
function addsMembers(o) {
  return o.x + o.y;
}
function storesMember(o) {
  o.x = 1;
  return o.x;
}

const stored = [
  ["a number", () => { process.env.IMPOSTOR_VALUE = 7; }],
  ["a text", () => { process.env.IMPOSTOR_VALUE = "3"; }],
  ["a fraction", () => { process.env.IMPOSTOR_VALUE = 2.5; }],
  ["minus zero", () => { process.env.IMPOSTOR_VALUE = -0; }],
  ["the largest int32", () => { process.env.IMPOSTOR_VALUE = 2147483647; }],
  ["true", () => { process.env.IMPOSTOR_VALUE = true; }],
  ["null", () => { process.env.IMPOSTOR_VALUE = null; }],
  ["an empty text", () => { process.env.IMPOSTOR_VALUE = ""; }],
  ["an object with toString", () => { process.env.IMPOSTOR_VALUE = { toString() { log.push("toString"); return "12"; } }; }],
  ["an array", () => { process.env.IMPOSTOR_VALUE = [4, 5]; }],
  ["a bigint", () => { process.env.IMPOSTOR_VALUE = 10n; }],
];
for (const [label, store] of stored) {
  attempt("storing " + label, () => {
    store();
    return [typeof process.env.IMPOSTOR_VALUE, process.env.IMPOSTOR_VALUE];
  });
  attempt("truncates " + label, () => truncates("IMPOSTOR_VALUE"));
  attempt("addsOne " + label, () => addsOne("IMPOSTOR_VALUE"));
  attempt("readsCharCode " + label, () => readsCharCode("IMPOSTOR_VALUE"));
  attempt("iterates " + label, () => iterates("IMPOSTOR_VALUE"));
}
delete process.env.IMPOSTOR_VALUE;
attempt("truncates what is not set", () => truncates("IMPOSTOR_VALUE"));
attempt("addsOne to what is not set", () => addsOne("IMPOSTOR_VALUE"));
attempt("readsCharCode of what is not set", () => readsCharCode("IMPOSTOR_VALUE"));
attempt("iterates what is not set", () => iterates("IMPOSTOR_VALUE"));

for (let i = 0; i < 2000; i++) {
  addsMembers({ x: 1, y: 2 });
  storesMember({ x: 0, y: 2 });
}
process.env.x = 1;
process.env.y = 2;
attempt("addsMembers of the environment", () => addsMembers(process.env));
attempt("storesMember of the environment", () => storesMember(process.env));
attempt("addsMembers of an object", () => addsMembers({ x: 1, y: 2 }));
attempt("storesMember of an object", () => storesMember({ x: 0, y: 2 }));
delete process.env.x;
attempt("addsMembers after a delete", () => addsMembers(process.env));
delete process.env.y;

function truncatesArgument(index) {
  const n = process.argv[index];
  return n | 0;
}
function addsOneToArgument(index) {
  const n = process.argv[index];
  return n + 1;
}
function countsArguments() {
  const n = process.argv.length;
  return [n | 0, n + 1];
}
function convertsArgument(index) {
  const text = process.argv[index];
  return [Number(text), parseInt(text, 10), +text, text | 0, text * 1, text - 0, text + 0];
}
attempt("how many arguments", countsArguments);
attempt("the kinds of the first two", () => [typeof process.argv[0], typeof process.argv[1], Array.isArray(process.argv)]);
attempt("truncates an argument that is not there", () => truncatesArgument(2));
attempt("addsOne to an argument that is not there", () => addsOneToArgument(2));
attempt("converts an argument that is not there", () => convertsArgument(2));
process.argv.push("41", "2.5", "0x10", "-0", "", " 7 ", "1e3", "ten", "2147483648");
for (let index = 2; index < process.argv.length; index++) {
  attempt("truncates " + show(process.argv[index]), () => truncatesArgument(index));
  attempt("addsOne " + show(process.argv[index]), () => addsOneToArgument(index));
  attempt("converts " + show(process.argv[index]), () => convertsArgument(index));
}
process.argv[2] = 41;
attempt("truncates a number stored among the arguments", () => truncatesArgument(2));
attempt("addsOne to a number stored among the arguments", () => addsOneToArgument(2));
