#!/usr/bin/env python3
"""references-in-every-slot-kind.py <seed>: a program that keeps references in every kind of place, beside a model of plain numbers, and takes random steps: store a NEW item into an old place, move an OLD item from place to place (no allocation), clear, collect the young
(once, or several times in a row with nothing or only stores between), collect fully, make garbage that takes the room of whatever was freed too early, check. It prints only sums: as plain Bun, and `wrong 0`."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
weights = dict(fresh=R.choice([5, 20, 40]), move=R.choice([20, 40, 60]), clear=R.choice([2, 8]), young=R.choice([5, 15, 30]), runOfYoung=R.choice([2, 8, 15]), full=R.choice([1, 2, 4]), garbage=R.choice([2, 6, 12]), check=R.choice([10, 30]), big=R.choice([0, 1, 3]), weak=R.choice([2, 6]))
steps = R.choice([20000, 40000, 60000])
print('''declare const console: { log(...values: unknown[]): void };
const shell: any = globalThis;
const young: () => void = typeof shell.edenGC === "function" ? shell.edenGC : () => shell.Bun.gc(false);
const full: () => void = typeof shell.fullGC === "function" ? shell.fullGC : () => shell.Bun.gc(true);
let state = %d;
function next(n: number): number { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
class Item { a: Item | null = null; b: Item | null = null; #c: Item | null = null; label: string; pad0 = 0; pad1 = 0;
  constructor(public id: number) { this.label = "item " + id; }
  get c(): Item | null { return this.#c; } set c(v: Item | null) { this.#c = v; } }
class Wide { f0: Item | null = null; f1: Item | null = null; f2: Item | null = null; f3: Item | null = null; f4: Item | null = null; f5: Item | null = null; f6: Item | null = null; f7: Item | null = null; n = 0.5; s = ""; }
let made = 0; function fresh(): Item { return new Item(++made); }
type Place = { get(): Item | null; set(v: Item | null): void };
const places: Place[] = []; const model: number[] = [];
function add(p: Place): void { places.push(p); model.push(0); }
const items: Item[] = []; for (let i = 0; i < 64; i++) items.push(fresh());
for (const o of items) { add({ get: () => o.a, set: v => { o.a = v; } }); add({ get: () => o.b, set: v => { o.b = v; } }); add({ get: () => o.c, set: v => { o.c = v; } }); }
const wides: Wide[] = []; for (let i = 0; i < 16; i++) wides.push(new Wide());
for (const w of wides) { add({ get: () => w.f0, set: v => { w.f0 = v; } }); add({ get: () => w.f3, set: v => { w.f3 = v; } }); add({ get: () => w.f7, set: v => { w.f7 = v; } }); }
const list: (Item | null)[] = new Array(200).fill(null); for (let i = 0; i < 200; i += 3) add({ get: () => list[i], set: v => { list[i] = v; } });
const large: (Item | null)[] = new Array(20000).fill(null); for (let i = 0; i < 20000; i += 499) add({ get: () => large[i], set: v => { large[i] = v; } });
const plain: any = {}; for (let i = 0; i < 40; i++) { const k = "k" + i; plain[k] = null; add({ get: () => plain[k], set: v => { plain[k] = v; } }); }
const named: any = { x: null, y: null, z: null }; add({ get: () => named.x, set: v => { named.x = v; } }); add({ get: () => named.y, set: v => { named.y = v; } }); add({ get: () => named.z, set: v => { named.z = v; } });
const map = new Map<number, Item | null>(); for (let i = 0; i < 40; i++) { map.set(i, null); add({ get: () => map.get(i) ?? null, set: v => { map.set(i, v); } }); }
const byText = new Map<string, Item | null>(); for (let i = 0; i < 20; i++) { const k = "t" + i; byText.set(k, null); add({ get: () => byText.get(k) ?? null, set: v => { byText.set(k, v); } }); }
const weak = new WeakMap<Item, Item | null>(); for (let i = 0; i < 32; i++) { const key = items[i]; add({ get: () => weak.get(key) ?? null, set: v => { weak.set(key, v); } }); }
for (let i = 0; i < 40; i++) { let held: Item | null = null; add({ get: () => held, set: v => { held = v; } }); }
let m0: Item | null = null, m1: Item | null = null, m2: Item | null = null; add({ get: () => m0, set: v => { m0 = v; } }); add({ get: () => m1, set: v => { m1 = v; } }); add({ get: () => m2, set: v => { m2 = v; } });
const sym = Symbol("place"); const bySymbol: any[] = []; for (let i = 0; i < 10; i++) { const o: any = { [sym]: null }; bySymbol.push(o); add({ get: () => o[sym], set: v => { o[sym] = v; } }); }
const boxes: { v: Item | null }[] = []; for (let i = 0; i < 30; i++) { const b: { v: Item | null } = { v: null }; boxes.push(b); add({ get: () => b.v, set: v => { b.v = v; } }); }
const setOf = new Set<Item>(); const inSet: number[] = [];
const refs: WeakRef<Item>[] = []; const refIds: number[] = []; const keepers: (Item | null)[] = [];
full(); young(); young();
let wrong = 0, checks = 0, youngs = 0, fulls = 0, sum = 0;
function check(i: number): void { const got = places[i].get(); checks++; const want = model[i]; if (want === 0 ? got !== null : got === null || got.id !== want || got.label !== "item " + want) { wrong++; if (wrong < 5) console.log("WRONG at place", i, "want", want, "got", got === null ? "null" : got.id + " " + got.label); } else if (got !== null) sum = (sum + got.id) %% 1000003; }
function garbage(n: number): void { let last: Item | null = null; for (let i = 0; i < n; i++) { const g = new Item(-1 - i); g.a = last; last = i %% 7 ? g : null; } }
const W = [%d, %d, %d, %d, %d, %d, %d, %d, %d, %d]; let total = 0; for (const w of W) total += w;
for (let step = 0; step < %d; step++) {
  let r = next(total), kind = 0; while (r >= W[kind]) { r -= W[kind]; kind++; }
  const i = next(places.length), j = next(places.length);
  switch (kind) {
    case 0: { const v = fresh(); places[i].set(v); model[i] = v.id; break; }
    case 1: { places[j].set(places[i].get()); model[j] = model[i]; break; }
    case 2: places[i].set(null); model[i] = 0; break;
    case 3: young(); youngs++; break;
    case 4: { const n = 2 + next(4); for (let k = 0; k < n; k++) { young(); youngs++; if (next(2)) { const a = next(places.length), b = next(places.length); places[b].set(places[a].get()); model[b] = model[a]; } } if (next(2)) { const v = fresh(); places[i].set(v); model[i] = v.id; young(); youngs++; garbage(200); check(i); } break; }
    case 5: full(); fulls++; break;
    case 6: garbage(50 + next(2000)); break;
    case 7: check(i); check(j); break;
    case 8: { const bigOne: (Item | null)[] = new Array(3000 + next(9000)).fill(null); const v = fresh(); bigOne[next(bigOne.length)] = v; const at = bigOne.indexOf(v); const holder = fresh(); holder.a = bigOne[at]; places[i].set(holder); model[i] = holder.id; break; }
    case 9: { if (refs.length < 50) { const v = fresh(); refs.push(new WeakRef(v)); refIds.push(v.id); keepers.push(next(2) ? v : null); } else { const k = next(refs.length); const got = refs[k].deref(); if (keepers[k] !== null && (got === undefined || got.id !== refIds[k])) wrong++; if (got !== undefined && got.id !== refIds[k]) wrong++; if (next(4) === 0) keepers[k] = null; } const it = items[next(items.length)]; if (setOf.has(it)) setOf.delete(it); else setOf.add(it); break; }
  }
}
for (let i = 0; i < places.length; i++) check(i);
full(); garbage(5000); for (let i = 0; i < places.length; i++) check(i);
console.log("places", places.length, "made", made, "checks", checks, "collections of the young", youngs, "full", fulls, "sum", sum, "wrong", wrong, "set", setOf.size);''' % (seed * 7919 + 13, weights['fresh'], weights['move'], weights['clear'], weights['young'], weights['runOfYoung'], weights['full'], weights['garbage'], weights['check'], weights['big'], weights['weak'], steps))
