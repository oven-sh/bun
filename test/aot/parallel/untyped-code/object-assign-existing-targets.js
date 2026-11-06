// Object.assign(target, source ..) where the target is there already, or a second source follows the first: every property is stored, which asks the target and what it inherits from: setters run, what cannot be written refuses, `__proto__` changes the prototype. Where none of that is in the way the properties of a source of one shape go into a target of one shape by a plan that is made once.
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts, ...besides) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
const lines = [];
const mark = Symbol("mark"), other = Symbol("other");
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",");
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const calls = [];
const parse = text => JSON.parse(text);
const sources = {
  three: () => parse('{"a":1,"b":2,"c":3}'),
  none: () => ({}),
  symbols: () => { const s = { a: 1 }; s[mark] = 2; s.b = 3; s[other] = 4; return s; },
  hidden: () => { const s = { a: 1 }; Object.defineProperty(s, "h", { value: 2, enumerable: false }); s.b = 3; return s; },
  getter: () => ({ a: 1, get b() { calls.push("get b"); return 2; }, c: 3 }),
  proto: () => parse('{"a":1,"__proto__":{"inherited":9},"b":2}'),
  elements: () => ({ a: 1, 0: "zero", 2: "two" }),
  many: () => { const s = {}; for (let i = 0; i < 20; i++) s["m" + i] = i; return s; },
  frozen: () => Object.freeze({ a: 1, b: 2 }),
  deleted: () => { const s = { a: 1, x: 0, b: 2 }; delete s.x; return s; },
  instance: () => new (class { constructor() { this.a = 1; this.b = 2; } method() {} })(),
  text: () => "hi", number: () => 5, nothing: () => undefined, nil: () => null, list: () => [7, 8],
};
const watching = { set b(v) { calls.push("inherited set b " + v); }, get b() { return "inherited"; } };
const fixed = Object.defineProperty({}, "b", { value: "fixed", writable: false, enumerable: true, configurable: true });
const targets = {
  one: () => ({ p: 0 }),
  empty: () => ({}),
  same: () => ({ a: 10, b: 20, c: 30 }),
  some: () => ({ b: 20, z: 0 }),
  nullProto: () => { const t = Object.create(null); t.p = 0; return t; },
  ownSetter: () => ({ p: 0, set b(v) { calls.push("own set b " + v); } }),
  ownGetterOnly: () => ({ p: 0, get b() { return 0; } }),
  ownReadOnly: () => Object.defineProperty({ p: 0 }, "b", { value: 0, writable: false, enumerable: true, configurable: true }),
  ownHidden: () => Object.defineProperty({ p: 0 }, "b", { value: 0, writable: true, enumerable: false, configurable: true }),
  inheritsSetter: () => { const t = Object.create(watching); t.p = 0; return t; },
  inheritsReadOnly: () => { const t = Object.create(fixed); t.p = 0; return t; },
  frozen: () => Object.freeze({ p: 0, a: 0 }),
  sealed: () => Object.seal({ p: 0, a: 0 }),
  closed: () => Object.preventExtensions({ p: 0, a: 0 }),
  full: () => ({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 }),
  list: () => [1],
  callable: () => function () {},
};
for (let turn = 0; turn < 3; turn++)
  for (const t in targets) for (const s in sources) {
    const before = calls.length, target = targets[t]();
    const said = attempt(() => Object.assign(target, sources[s]()) === target);
    lines.push(turn + " " + t + " <- " + s + ": " + said + " " + show(target) + " | " + (Object.getPrototypeOf(target) === null ? "null" : Object.keys(Object.getPrototypeOf(target)).join()) + " | " + calls.slice(before).join());
  }
for (let turn = 0; turn < 3; turn++) lines.push("several: " + show(Object.assign({}, sources.three(), sources.symbols(), { c: 9, d: 10 })) + " | " + show(Object.assign({ z: 0 }, null, sources.three(), undefined, sources.deleted())));

function Kind() {}
for (let turn = 0; turn < 3; turn++) {
  const made = new Kind(), seenBefore = made.added;
  Object.assign(Kind.prototype, { added() { return "added " + turn; }, ["more" + turn]: turn });
  lines.push("a prototype: " + typeof seenBefore + " " + made.added() + " " + Object.keys(Kind.prototype).join());
}
const late = {};
const heirOfLate = () => { const t = Object.create(late); t.p = 0; return t; };
for (let turn = 0; turn < 4; turn++) lines.push("before: " + show(Object.assign(heirOfLate(), sources.three())));
Object.defineProperty(late, "b", { set(v) { calls.push("late set b " + v); }, configurable: true });
for (let turn = 0; turn < 4; turn++) { const before = calls.length; lines.push("behind: " + show(Object.assign(heirOfLate(), sources.three())) + " | " + calls.slice(before).join()); }
const kept = { a: 0, b: 0, c: 0 };
const readKept = () => kept.a + kept.b + kept.c;
for (let turn = 0; turn < 5; turn++) { Object.assign(kept, parse(`{"a":${turn},"b":${turn * 2},"c":${turn * 3}}`)); lines.push("kept: " + readKept()); }
let grown = {};
for (let i = 0; i < 100; i++) grown = Object.assign(grown, { ["g" + i]: i });
lines.push("grown: " + Object.keys(grown).length + " " + grown.g0 + " " + grown.g99);

const start = countsSoFar();
let sum = 0;
for (let i = 0; i < 2000; i++) sum += Object.assign({ p: i }, sources.three()).c + Object.assign({}, sources.three(), sources.deleted()).b + Object.assign(targets.same(), sources.three()).a;
lines.push(sum + " " + (callsIn(countsSoFar()) - callsIn(start) <= 100));
console.log(lines.join("\n"));
