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

function pushes(a) {
  a.push(1);
  return a.length;
}
function iterates(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
function readsCharCodeOfTheFirst(a) {
  return a[0].charCodeAt(0);
}
function readsCharCodeOfTheFirstRawText(a) {
  return a.raw[0].charCodeAt(0);
}
function storesTheFirst(a) {
  a[0] = "changed";
  return a[0];
}
function setsTheLength(a) {
  a.length = 0;
  return a.length;
}
function addsAMember(a) {
  a.x = 1;
  return a.x;
}
function returnsIt(a) {
  return a;
}

for (let i = 0; i < 2000; i++) {
  pushes(["a", "b"]);
  iterates(["a", "b"]);
  readsCharCodeOfTheFirst(["a", "b"]);
  storesTheFirst(["a", "b"]);
  setsTheLength(["a", "b"]);
  addsAMember(["a", "b"]);
}

attempt("pushes as a tag", () => pushes`a${0}b`);
attempt("pushes an array", () => pushes(["a", "b"]));
attempt("iterates as a tag", () => iterates`a${0}b`);
attempt("iterates as a tag with an escape that is no text", () => iterates`\unicode${0}\xerxes${1}c`);
attempt("iterates an array", () => iterates(["a", "b"]));
attempt("readsCharCodeOfTheFirst as a tag", () => readsCharCodeOfTheFirst`a${0}b`);
attempt("readsCharCodeOfTheFirst as a tag with an empty first text", () => readsCharCodeOfTheFirst`${0}b`);
attempt("readsCharCodeOfTheFirst as a tag with an escape that is no text", () => readsCharCodeOfTheFirst`\unicode`);
attempt("readsCharCodeOfTheFirst of an array", () => readsCharCodeOfTheFirst(["a", "b"]));
attempt("readsCharCodeOfTheFirstRawText as a tag", () => readsCharCodeOfTheFirstRawText`\n`);
attempt("readsCharCodeOfTheFirstRawText as a tag with an escape that is no text", () => readsCharCodeOfTheFirstRawText`\unicode`);
attempt("readsCharCodeOfTheFirstRawText of an array", () => readsCharCodeOfTheFirstRawText(["a", "b"]));
attempt("storesTheFirst as a tag", () => storesTheFirst`a${0}b`);
attempt("storesTheFirst of an array", () => storesTheFirst(["a", "b"]));
attempt("setsTheLength as a tag", () => setsTheLength`a${0}b`);
attempt("setsTheLength of an array", () => setsTheLength(["a", "b"]));
attempt("addsAMember as a tag", () => addsAMember`a${0}b`);
attempt("addsAMember to an array", () => addsAMember(["a", "b"]));
attempt("what a tag gets", () => returnsIt`a${0}\n`);
attempt("frozen, and its raw texts too", () => [Object.isFrozen(returnsIt`a`), Object.isFrozen(returnsIt`a`.raw), Array.isArray(returnsIt`a`.raw)]);

const here = () => returnsIt`same place`;
attempt("one place hands over one array", () => [here() === here(), here() === returnsIt`same place`]);
attempt("a loop at one place", () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(returnsIt`in a loop ${i}`);
  return seen.size;
});
