// `for (const [key, value] of Object.entries(object))` where the loop alone has the list: in code that runs once and in a function that runs often, over objects that the compiler knows and over objects that it does not.
// What each loop sees, in which order, and that it sees the object as it was when the loop began. Then Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)), which goes by a helper of the same kind.
// Once warm, a walk calls the function that lists and enters the run time for nothing else. Only the jsc shell can count; elsewhere the counts are zero.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
function callsIn(counts) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined) sum += Number(calls);
  }
  return sum;
}
const lines = [];
const handlers = {
  double(n) { return n * 2; },
  negate: n => -n,
  describe(n) { return "<" + n + ">"; },
};
for (const [name, handle] of Object.entries(handlers)) lines.push(name + ": " + handle(21));

const mark = Symbol("mark");
class Point { constructor(x, y) { this.x = x; this.y = y; } get sum() { return this.x + this.y; } }
const seen = [];
const sources = {
  parsed: () => JSON.parse('{"a":1,"b":"two","c":[3]}'),
  literal: () => ({ a: 1, b: "two" }),
  empty: () => ({}),
  instance: () => new Point(3, 4),
  getter: () => ({ a: 1, get b() { seen.push("get b"); return 2; }, c: 3 }),
  symbols: () => ({ a: 1, [mark]: 2, b: 3 }),
  hidden: () => Object.defineProperty({ a: 1 }, "h", { value: 2, enumerable: false }),
  indexes: () => ({ b: 1, 2: "two", a: 2, 0: "zero" }),
  deleted: () => { const o = { a: 1, x: 0, b: 2 }; delete o.x; return o; },
  withoutParent: () => Object.assign(Object.create(null), { a: 1 }),
  list: () => ["x", "y"],
  text: () => "hi",
  number: () => 5,
  proxy: () => new Proxy({ a: 1, b: 2 }, {
    ownKeys(target) { seen.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { seen.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key) { seen.push("get " + String(key)); return target[key]; },
  }),
};
function walk(object) {
  let text = "";
  for (const [key, value] of Object.entries(object)) text += key + "=" + String(value) + ";";
  return text;
}
for (const [name, make] of Object.entries(sources)) lines.push(name + ": " + walk(make()) + " " + seen.splice(0).join());
for (const nothing of [undefined, null]) {
  try { lines.push(walk(nothing)); } catch (error) { lines.push(String(nothing) + ": " + error.constructor.name); }
}

function walkAndChange(object) {
  let text = "";
  for (const [key, value] of Object.entries(object)) {
    text += key + "=" + value + ";";
    object.added = "late";
    object.b = "changed";
    delete object.c;
  }
  return text + " then " + walk(object);
}
lines.push("changed in the loop: " + walkAndChange({ a: 1, b: 2, c: 3 }), "changed in the loop: " + walkAndChange(JSON.parse('{"a":1,"b":2,"c":3}')));

function kept(object) {
  const pairs = [];
  for (const pair of Object.entries(object)) pairs.push(pair);
  return pairs;
}
const pairs = kept({ a: 1, b: 2 });
lines.push("pairs that are kept: " + JSON.stringify(pairs) + " " + (pairs[0] !== pairs[1]) + " " + Array.isArray(pairs[0]));

const describe = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join();
const copy = (target, source) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
for (const [name, make] of Object.entries(sources)) {
  if (name === "number" || name === "text" || name === "list") continue;
  lines.push("copied " + name + ": " + describe(copy({ z: 0 }, make())) + " " + seen.splice(0).join());
}

function total(object) {
  let sum = 0;
  for (const [key, value] of Object.entries(object)) sum += key.length + value;
  return sum;
}
const numbers = [JSON.parse('{"a":1,"bb":2,"ccc":3}'), { a: 1, bb: 2 }, new Point(3, 4)];
let sum = 0;
const round = turns => { for (let i = 0; i < turns; i++) for (const object of numbers) sum += total(object); };
round(2000);
const before = countsSoFar();
round(2000);
const after = countsSoFar();
lines.push("sum " + sum, "6000 walks entered the run time " + (callsIn(after) - callsIn(before)) + " times besides the call that lists");
console.log(lines.join("\n"));
