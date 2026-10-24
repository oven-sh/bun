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

const named = text => text.split("").reverse().join("");
const PUSH = named("hsup");
const CHAR_CODE_AT = named("tAedoCrahc");
const VALUE_OF = named("fOeulav");
const X = named("x");
const Y = named("y");
const LENGTH = named("htgnel");

function pushes(a) {
  a.push(1);
  return a.length;
}

function iterates(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(s) {
  return s.charCodeAt(0);
}

function truncates(n) {
  return n | 0;
}

function addsOne(n) {
  return n + 1;
}

function calls(f) {
  return f(1);
}

function addsMembers(o) {
  return o.x + o.y;
}

function storesMember(o) {
  o.x = 1;
  return o;
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass whose push has a computed name", () => new (class extends Array { [PUSH](value) { log.push("computed push " + value); return 42; } })(5, 6)],
  ["an object whose push has a computed name", () => ({ [LENGTH]: 7, [PUSH](value) { log.push("computed push " + value); return "pushed"; }, [Symbol.iterator]: () => [8, 9][Symbol.iterator]() })],
  ["an array that got a push under a computed name", () => { const a = [5, 6]; a[PUSH] = value => { log.push("stored push " + value); return -1; }; return a; }],
  ["an array that got a push by defineProperty", () => Object.defineProperty([5, 6], PUSH, { value(value) { log.push("defined push " + value); return -2; } })],
  ["an array whose prototype got a push by Object.assign", () => Object.setPrototypeOf([5, 6], Object.assign(Object.create(Array.prototype), { [PUSH](value) { log.push("assigned push " + value); return -3; } }))],
  ["an object made from entries", () => Object.fromEntries([[LENGTH, 7], [PUSH, value => { log.push("entry push " + value); }], ["0", 5]])],
];
const strings = [
  ["a string", () => "abc"],
  ["an object whose charCodeAt has a computed name", () => ({ [CHAR_CODE_AT](index) { log.push("computed charCodeAt " + index); return "mine"; } })],
  ["a String object that got one under a computed name", () => { const s = new String("xyz"); s[CHAR_CODE_AT] = () => -1; return s; }],
  ["an instance of a class with a computed method", () => new (class { [CHAR_CODE_AT]() { return "of the class"; } })()],
];
const numbers = [
  ["an integer", () => 7],
  ["an object whose valueOf has a computed name", () => ({ [VALUE_OF]() { log.push("computed valueOf"); return 2 ** 31 + 0.5; } })],
  ["a Number object that got one under a computed name", () => { const n = new Number(7); n[VALUE_OF] = () => "3"; return n; }],
  ["an instance of a class with a computed valueOf", () => new (class { [VALUE_OF]() { return 10n; } })()],
];
const functions = [
  ["a function", () => x => x + 1],
  ["a method read under a computed name", () => ({ [X]: x => "method " + x })[X]],
  ["a class read under a computed name", () => ({ [X]: class Made {} })[X]],
];
const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["members under computed names", () => ({ [X]: 10, [Y]: 20 })],
  ["members under computed names in another order", () => ({ [Y]: "2", [X]: "1" })],
  ["members stored under computed names", () => { const o = {}; o[Y] = 2; o[X] = 1; return o; }],
  ["accessors under computed names", () => ({ get [X]() { log.push("get x"); return 10; }, set [X](value) { log.push("set x " + value); }, get [Y]() { log.push("get y"); return 20; } })],
  ["accessors defined under computed names", () => Object.defineProperty({ x: 1, y: 2 }, X, { get() { log.push("defined get x"); return 100; }, set(value) { log.push("defined set x " + value); } })],
  ["a read-only member defined under a computed name", () => Object.defineProperty({ x: 1, y: 2 }, X, { writable: false })],
  ["an instance of a class with computed fields", () => new (class { [X] = 3; [Y] = 4; })()],
  ["an instance of a class with computed accessors", () => new (class { get [X]() { log.push("class get x"); return 5; } set [X](value) { log.push("class set x " + value); } get [Y]() { return 6; } })()],
  ["an object made from entries", () => Object.fromEntries([[Y, 2], [X, 1]])],
  ["a member deleted under a computed name", () => { const o = { x: 1, y: 2 }; delete o[X]; return o; }],
];

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];
function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(make()));
  }
}
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes([5, 6]);
  iterates([5, 6]);
  readsCharCode("abc");
  truncates(7);
  addsOne(7);
  calls(x => x + 1);
  addsMembers(({ x: 1, y: 2 }));
  storesMember(({ x: 1, y: 2 }));
}
everyCase("after 2000");
