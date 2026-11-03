// The getter and the setter of one name in an object literal, in either order, side by side and with other members between them, defined twice, a setter alone, a getter alone, two names whose halves alternate: literals made
// again and again. What each object has, in which order and with which attributes, and that no two objects share a function. Once warm, each accessor lies in the object itself and no object gets a shape of its own.
// Only the jsc shell can count; elsewhere the counts are zero.
// Env: JSC_aotCountsPath=/dev/null
const counter = name => (typeof aotRuntimeCounters === "function" ? Number(new RegExp("(\\d+)\\tcounter:" + name + "\\n").exec(aotRuntimeCounters() + "\n")?.[1] ?? 0) : 0);
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) + (d.writable ? "w" : "-") : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join(" ");
const makers = {
  pair(s) { return { get a() { return s.n; }, set a(v) { s.n = v; }, tail: 1 }; },
  reversed(s) { return { set a(v) { s.n = v; }, get a() { return s.n; }, tail: 1 }; },
  reversedApart(s) { return { set a(v) { s.n = v; }, b: 1, get a() { return s.n; } }; },
  apart(s) { return { get a() { return s.n; }, b: 1, get c() { return 3; }, set a(v) { s.n = v; }, d: 4, set c(v) { s.c = v; } }; },
  twice(s) { return { get a() { return 1; }, get a() { return s.n; }, set a(v) { s.m = v; }, set a(v) { s.n = v; } }; },
  setterOnly(s) { return { b: 1, set a(v) { s.n = v; } }; },
  getterOnly(s) { return { get a() { return s.n; }, b: 1 }; },
  two(s) { return { get a() { return s.n; }, set z(v) { s.z = v; }, set a(v) { s.n = v; }, get z() { return s.z; } }; },
  valueBetween(s) { return { get a() { return 1; }, a: 2, set a(v) { s.n = v; } }; },
  spreadBetween(s) { return { get a() { return s.n; }, ...s.more, set a(v) { s.n = v; } }; },
  keyBetween(s) { return { get a() { return s.n; }, [s.key]: 7, set a(v) { s.n = v; } }; },
};
const lines = [];
function run(name, make, turns) {
  const said = new Set(), functions = new Set();
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const s = { n: i, more: i % 3 ? null : { a: "spread" }, key: i % 3 ? "k" : "a" }, o = make(s);
    said.add(show(o));
    const before = o.a;
    try { o.a = i + 1; } catch (error) { sum -= 1000; }
    sum += (typeof before === "number" ? before : -1) + s.n + (typeof o.a === "number" ? o.a : -1);
    const d = Object.getOwnPropertyDescriptor(o, "a");
    for (const half of [d.get, d.set]) {
      if (!half) continue;
      if (functions.has(half)) lines.push(name + ": TWO OBJECTS SHARE A FUNCTION");
      functions.add(half);
    }
    if (i === 150) said.add("frozen " + show(Object.freeze(o)));
  }
  return [...said].join(" | ") + " " + sum;
}
for (const [name, make] of Object.entries(makers)) lines.push(name + ": " + run(name, make, 300) + " " + JSON.stringify(make({ n: 5 })) + " " + Object.keys(make({ n: 6 })).join());
const left = () => counter("FieldsLeftSlotByRedefinition") + counter("FieldsLeftSlotByStoreOfOtherType");
const leftBefore = left(), shapesBefore = counter("CompiledStructuresMade");
for (const name of ["pair", "reversed", "reversedApart", "apart", "twice", "setterOnly", "two"]) run(name, makers[name], 149);
lines.push("accessors that left the object: " + (left() - leftBefore), "shapes made: " + (counter("CompiledStructuresMade") - shapesBefore));
console.log(lines.join("\n"));
