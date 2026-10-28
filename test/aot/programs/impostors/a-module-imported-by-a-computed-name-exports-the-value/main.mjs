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

async function outcome(run) {
  log.length = 0;
  try {
    const value = await run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

async function attempt(label, run) {
  console.log(label + " -> " + (await outcome(run)));
}

console.log("strict:", (function () { return this === undefined; })());

const embedded = [() => import("./honest.mjs"), () => import("./first.mjs"), () => import("./second.mjs"), () => import("./third.mjs")];
const fileOf = set => "./" + set + ".mjs";

async function pushes(file) {
  const a = (await import(file)).a();
  a.push(1);
  return [a.length];
}

async function iterates(file) {
  const a = (await import(file)).a();
  const seen = [];
  for (const x of a) seen.push(x);
  return [seen];
}

async function readsCharCode(file) {
  const s = (await import(file)).s();
  return [s.charCodeAt(0)];
}

async function truncates(file) {
  const n = (await import(file)).n();
  return [n | 0];
}

async function addsOne(file) {
  const n = (await import(file)).n();
  return [n + 1];
}

async function calls(file) {
  const f = (await import(file)).f();
  return [f(1)];
}

async function addsMembers(file) {
  const o = (await import(file)).o();
  return [o.x + o.y];
}

async function storesMember(file) {
  const o = (await import(file)).o();
  o.x = 1;
  return [o];
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

async function everyCase(round) {
  for (const [name, use] of table) {
    for (const set of ["honest", "first", "second", "third", "honest"]) await attempt(round + " " + name + " " + set, () => use(fileOf(set)));
  }
}

console.log("embedded", embedded.length);
await everyCase("at first");
for (let i = 0; i < 500; i++) {
  await pushes(fileOf("honest"));
  await iterates(fileOf("honest"));
  await readsCharCode(fileOf("honest"));
  await truncates(fileOf("honest"));
  await addsOne(fileOf("honest"));
  await calls(fileOf("honest"));
  await addsMembers(fileOf("honest"));
  await storesMember(fileOf("honest"));
}
await everyCase("after 500");
