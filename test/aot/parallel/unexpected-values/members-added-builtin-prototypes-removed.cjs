// Members added to built in prototypes and removed in the middle of a loop.
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

function addsMembers(o, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(o.x + o.y);
  }
  return "done";
}
function truncates(n, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(n | 0);
  }
  return "done";
}
function subtracts(n, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(n - 1);
  }
  return "done";
}
function joins(e, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push("" + e);
  }
  return "done";
}
function serializes(d, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(JSON.stringify([d]));
  }
  return "done";
}
function parses(text, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    const n = JSON.parse(text);
    results.push(n + 1);
  }
  return "done";
}

function trims(s, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(s.trim());
  }
  return "done";
}
function takesTheFirst(s, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(s.at(0));
  }
  return "done";
}

function during(use, value, put, restore) {
  const results = [];
  const end = outcome(() =>
    use(value, results, i => {
      if (i === 2) put();
      if (i === 4) restore();
    }),
  );
  return show(results) + " " + end;
}
function member(prototype, name, value) {
  const had = Object.getOwnPropertyDescriptor(prototype, name);
  return [
    () => Object.defineProperty(prototype, name, typeof value === "object" ? { ...value, configurable: true } : { value, writable: true, configurable: true }),
    () => (had ? Object.defineProperty(prototype, name, had) : delete prototype[name]),
  ];
}
class Stamp extends Date {}
function both(first, second) {
  return [() => (first[0](), second[0]()), () => (first[1](), second[1]())];
}

for (let i = 0; i < 300; i++) {
  addsMembers({ x: 1, y: 2 }, [], () => {});
  truncates(new Date(7), [], () => {});
  subtracts(new Date(7), [], () => {});
  joins(new RangeError("r"), [], () => {});
  serializes(new Date(0), [], () => {});
  parses("7", [], () => {});
  trims(" a ", [], () => {});
  takesTheFirst("abc", [], () => {});
}

console.log("x and y on Array.prototype: " + during(addsMembers, [5, 6], ...both(member(Array.prototype, "x", 1), member(Array.prototype, "y", 2))));
console.log("x and y on String.prototype: " + during(addsMembers, "abc", ...both(member(String.prototype, "x", 1), member(String.prototype, "y", 2))));
console.log("x and y on Number.prototype: " + during(addsMembers, 5, ...both(member(Number.prototype, "x", 1), member(Number.prototype, "y", 2))));
console.log("getters x and y on Number.prototype: " + during(addsMembers, 5, ...both(member(Number.prototype, "x", { get() { log.push("get x " + typeof this); return this + 1; } }), member(Number.prototype, "y", { get() { log.push("get y"); return 2; } }))));
console.log("x and y on Date.prototype: " + during(addsMembers, new Date(0), ...both(member(Date.prototype, "x", 1), member(Date.prototype, "y", 2))));
console.log("x and y on Map.prototype: " + during(addsMembers, new Map(), ...both(member(Map.prototype, "x", 1), member(Map.prototype, "y", 2))));
console.log("an object in between: " + during(addsMembers, { x: 1, y: 2 }, () => {}, () => {}));
console.log("valueOf of a class below Date, truncated: " + during(truncates, new Stamp(7), ...member(Stamp.prototype, "valueOf", function () { log.push("valueOf"); return 2 ** 31 + 0.5; })));
console.log("valueOf of a class below Date, subtracted: " + during(subtracts, new Stamp(7), ...member(Stamp.prototype, "valueOf", function () { log.push("valueOf"); return "3"; })));
console.log("toString of Error.prototype: " + during(joins, new RangeError("r"), ...member(Error.prototype, "toString", function () { log.push("toString"); return "replaced " + this.message; })));
console.log("name of RangeError.prototype: " + during(joins, new RangeError("r"), ...member(RangeError.prototype, "name", "Renamed")));
console.log("toJSON of a class below Date: " + during(serializes, new Stamp(0), ...member(Stamp.prototype, "toJSON", function () { log.push("toJSON"); return 5; })));
console.log("toISOString of a class below Date: " + during(serializes, new Stamp(0), ...member(Stamp.prototype, "toISOString", function () { log.push("toISOString"); return { not: "a text" }; })));
console.log("trim of String.prototype: " + during(trims, " a ", ...member(String.prototype, "trim", function () { log.push("trim " + typeof this); return 5; })));
console.log("at of String.prototype: " + during(takesTheFirst, "abc", ...member(String.prototype, "at", function (index) { log.push("at " + index); return ["replaced"]; })));
console.log("at of String.prototype, for an array: " + during(takesTheFirst, ["abc"], ...member(String.prototype, "at", () => "replaced")));
console.log("JSON.stringify: " + during(serializes, new Date(0), ...member(JSON, "stringify", value => { log.push("stringify"); return value.length; })));
console.log("JSON.parse: " + during(parses, "7", ...member(JSON, "parse", text => { log.push("parse"); return text; })));
