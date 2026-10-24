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

function Old(x) {
  this.x = x;
  this.y = 2;
}
class New {
  constructor(x) {
    this.x = x;
    this.y = 2;
  }
}
class WithFields {
  x = 0;
  y = 2;
  constructor(x) {
    this.x = x;
  }
}
class Derived extends New {
  constructor(x) {
    super(x);
    this.z = 3;
  }
}
const base = {};
const makers = [
  ["a constructor function", Old.prototype, x => new Old(x)],
  ["a class", New.prototype, x => new New(x)],
  ["a class with fields", WithFields.prototype, x => new WithFields(x)],
  ["a derived class", New.prototype, x => new Derived(x)],
  ["a derived class, its own prototype", Derived.prototype, x => new Derived(x)],
  ["Object.create and two stores", base, x => { const o = Object.create(base); o.x = x; o.y = 2; return o; }],
  ["a literal with __proto__", base, x => ({ __proto__: base, x, y: 2 })],
  ["Object.assign onto an heir", base, x => Object.assign(Object.create(base), { x, y: 2 })],
];
const appearing = [
  ["a setter", { set(value) { log.push("set x " + value); }, configurable: true }],
  ["a getter without a setter", { get() { log.push("get x"); return "got"; }, configurable: true }],
  ["a read-only member", { value: "fixed", writable: false, configurable: true }],
  ["a writable member", { value: "inherited", writable: true, configurable: true }],
];

for (const [label, prototype, make] of makers) {
  for (let i = 0; i < 2000; i++) make(i);
  for (const [what, descriptor] of appearing) {
    const line = [];
    for (let i = 0; i < 6; i++) {
      if (i === 2) Object.defineProperty(prototype, "x", descriptor);
      if (i === 4) delete prototype.x;
      line.push(outcome(() => {
        const o = make(i);
        return [Object.keys(o), o.x];
      }));
    }
    delete prototype.x;
    console.log(label + ", " + what + " appears on the prototype and goes -> " + line.join(" ; "));
  }
}
