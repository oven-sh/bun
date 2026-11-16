// STATISTIC: SiteCachedReadsHoisted >= 20
// Under: --aot-check=Validate: the lookups stand in blocks of their own before the loop
// Under: --aot-testing=CheckEffectsAtRunTime: nothing that the loops do changes what is looked up
let log = [];
class Base { get a() { log.push("Ba"); return { b: 2, on: true }; } step() { return 1; } }
class Plain { constructor(v) { this.a = v; this.on = true; this.n = 4; } }
class Sub extends Plain { constructor() { super({ b: 5 }); } get late() { log.push("late"); return 1; } }
function makeValues() {
  const changing = { a: { b: 1 }, on: false, n: 2 };
  return [
  ["undefined", undefined], ["null", null], ["zero", 0], ["text", "abc"], ["true", true], ["symbol", Symbol.iterator], ["big", 10n],
  ["empty", {}], ["plain", { a: { b: 3 }, on: true, n: 7 }], ["deep", { a: { b: { c: 4 } }, on: 1, n: 1.5 }], ["noA", { a: null, on: 0 }], ["noB", { a: {}, on: "" }], ["undefB", { a: { b: undefined }, n: undefined }],
  ["textB", { a: { b: "x" }, on: "yes", n: "2" }], ["nan", { a: { b: NaN }, n: NaN }], ["getter", { get a() { log.push("ga"); return { get b() { log.push("gb"); return 6; } }; }, get on() { log.push("on"); return true; }, get n() { log.push("n"); return 3; } }],
  ["throwing", { get a() { log.push("ta"); throw new Error("a"); }, get on() { throw new Error("on"); }, n: 1 }], ["proxy", new Proxy({ a: { b: 8 }, on: true, n: 2 }, { get(t, k, r) { log.push("p" + String(k)); return Reflect.get(t, k, r); } })],
  ["base", new Base()], ["inst", new Plain({ b: 9 })], ["sub", new Sub()], ["nullProto", Object.assign(Object.create(null), { a: { b: 11 }, on: true, n: 1 })], ["inherited", Object.create({ a: { b: 12 }, on: true, n: 5 })],
  ["frozen", Object.freeze({ a: Object.freeze({ b: 13 }), on: true, n: 6 })], ["array", Object.assign([1, 2, 3], { a: { b: 14 }, n: 3 })], ["fn", Object.assign(() => 1, { a: { b: 15 }, on: true })], ["changing", changing], ["date", new Date(0)], ["map", new Map([["a", 1]])], ["bytes", new Uint8Array(3)], ["many", Object.fromEntries(Array.from({ length: 80 }, (_, i) => ["k" + i, i]).concat([["a", { b: 16 }], ["on", true], ["n", 9]]))],
  ["deleted", (() => { const o = { x: 1, a: { b: 17 }, on: true, n: 8 }; delete o.x; return o; })()], ["accessorLater", (() => { const o = { a: { b: 18 }, n: 4 }; return o; })()]
  ];
}
function show(v) { try { return typeof v === "object" && v !== null ? JSON.stringify(v) : typeof v === "symbol" ? "sym" : typeof v === "bigint" ? v + "n" : String(v) + ":" + typeof v; } catch (e) { return "E" + e; } }
const other = { a: { b: 40 }, on: false, n: 41 };
function sum(c) { let h = 0; for (let i = 0; i < 9; i++) h += c?.a?.b ?? 1; return h; }
function sumOfHeld(d) { let h = 0; for (let i = 0; i < 9; i++) h += d.c?.a?.b ?? 1; return h; }
function twoNames(c) { let h = 0; for (let i = 0; i < 9; i++) { h += c?.a?.b ?? 1; h += c?.n ?? 2; } return h; }
function branches(c) { let h = 0; for (let i = 0; i < 9; i++) { if (c?.on) h += i; else h--; } return h; }
function and(c) { let h = 0; for (let i = 0; i < 9; i++) { if (c && c.n) h += c.n; } return h; }
function choice(c) { let h = 0; for (let i = 0; i < 9; i++) h += c ? c.n : 2; return h; }
function deep(c) { let h = 0; for (let i = 0; i < 9; i++) h += c?.a?.b?.c ?? -1; return h; }
function nullish(c) { let h = 0; for (let i = 0; i < 9; i++) h += c == null ? 5 : c.n; return h; }
function inSome(c) { let h = 0; for (let i = 0; i < 9; i++) if (i > 3) h += c?.a?.b ?? 1; return h; }
function list(c, l) { let h = 0; for (const x of l) if (c?.on) h += x; else h -= c?.n ?? x; return h; }
function nested(c) { let h = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) h += c?.a?.b ?? j; return h; }
function storing(c) { let h = 0; for (let i = 0; i < 9; i++) { h += c?.n ?? 1; if (i === 4 && c && typeof c === "object" && !Object.isFrozen(c)) c.n = 100; } return h; }
function replaced(c) { let h = 0; for (let i = 0; i < 9; i++) { h += c?.a?.b ?? 1; if (i === 4) c = other; } return h; }
function deleting(c) { let h = 0; for (let i = 0; i < 9; i++) { h += c?.a?.b ?? 1; if (i === 4 && c && typeof c === "object" && !Object.isFrozen(c)) delete c.a; } return h; }
function early(c) { let h = 0; for (let i = 0; i < 99; i++) { if (c?.n !== undefined && h >= c.n) break; h += i; } return h; }
function noIteration(c, l) { let h = 0; for (let i = l.length; i < 3; i++) h += c?.a?.b ?? 1; return h; }
const fs = { sum, sumOfHeld, twoNames, branches, and, choice, deep, nullish, inSome, list, nested, storing, replaced, deleting, early, noIteration };
for (let round = 0; round < 3; round++)
  for (const [name, f] of Object.entries(fs)) {
    const said = [];
    for (const [label, v] of makeValues()) {
      log = [];
      let a;
      try {
        a = show(f(f === sumOfHeld ? { c: v } : v, [1, 2, 3, 4, 5]));
      } catch (e) {
        a = "threw " + e.constructor.name;
      }
      said.push(label + " " + a + (log.length ? " " + log.join() : ""));
    }
    console.log(round, name, said.join(" | "));
  }
