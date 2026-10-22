// Objects inside objects, one probe of many. It prints what plain Bun prints.
interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const map = new WeakMap<object, string>();
const set = new WeakSet<object>();
const keptOuter: Outer[] = [], keptInner: Inner[] = [];
const refsToInnerOfKeptOuter: WeakRef<Inner>[] = [], refsToOuterOfKeptInner: WeakRef<Outer>[] = [], refsToDead: WeakRef<object>[] = [];
let finalized = 0;
const registry = new FinalizationRegistry<number>(() => { finalized++; });
(function fill() {
  for (let i = 0; i < 2000; i++) {
    const a = make(i);
    map.set(a.c, "inner" + i); set.add(a.c);
    if (i % 3 === 0) { keptOuter.push(a); refsToInnerOfKeptOuter.push(new WeakRef(a.c)); }
    else if (i % 3 === 1) { keptInner.push(a.c); refsToOuterOfKeptInner.push(new WeakRef(a)); }
    else { refsToDead.push(new WeakRef(a)); refsToDead.push(new WeakRef(a.c)); registry.register(a.c, i); }
  }
})();
function churn() { let x = 0; for (let i = 0; i < 100000; i++) x += make(i).c.e; return x; }
await new Promise(r => setTimeout(r, 0));
for (let i = 0; i < 4; i++) { churn(); Bun.gc(true); await new Promise(r => setTimeout(r, 0)); }
let ok = 0;
for (let i = 0; i < keptOuter.length; i++) if (refsToInnerOfKeptOuter[i].deref() === keptOuter[i].c && map.get(keptOuter[i].c) === "inner" + keptOuter[i].b && set.has(keptOuter[i].c)) ok++;
let ok2 = 0;
for (const c of keptInner) if (map.get(c) === "inner" + (c.d - 1) && set.has(c)) ok2++;
console.log(ok, keptOuter.length, ok2, keptInner.length);
// Whether a dead pair is gone is the collector's business: only that a reference which answers gives a whole object.
let whole = 0; for (const r of refsToDead) { const o: any = r.deref(); if (o === undefined || typeof (o.b ?? o.d) === "number") whole++; }
let whole2 = 0; for (const r of refsToOuterOfKeptInner) { const o = r.deref(); if (o === undefined || o.c.d === o.b + 1) whole2++; }
console.log(whole === refsToDead.length, whole2 === refsToOuterOfKeptInner.length, finalized >= 0);
