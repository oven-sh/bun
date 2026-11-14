const out = [];
const show = v => (Array.isArray(v) ? "[" + v.map(show) + "]" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? Object.prototype.toString.call(v) + "{" + Object.keys(v).map(k => k + ":" + show(v[k])) + "}" : String(v));
const log = (...values) => out.push(values.map(show).join(" "));
const map = new Map([["a", 1], ["b", 2], ["c", 3]]), empty = new Map(), set = new Set([1, "x", -0]), list = JSON.parse("[3,1,4]"), doubles = [1.5, 2.5], holes = [1, , 3], bytes = new Uint8Array([7, 8]);
const large = new Map(); for (let i = 0; i < 1000; i++) large.set("k" + i, i);
const makers = [() => map.keys(), () => map.values(), () => map.entries(), () => map[Symbol.iterator](), () => empty.keys(), () => set.keys(), () => set.values(), () => set.entries(), () => list.keys(), () => list.values(), () => list.entries(), () => doubles.values(), () => holes.entries(), () => bytes.values(), () => large.values()];
const kept = [];
function take(it, n) { const taken = []; for (let k = 0; k < n; k++) { const r = it.next(); if (r.done) { taken.push("done"); break; } taken.push(r.value); } return taken; }
function rest(it) { let n = 0; for (const v of it) n += typeof v === "number" ? v : 1; return n; }
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < makers.length; i++) {
    const it = makers[i]();
    kept.push(it);
    if (kept.length > 300) kept.splice(0, 200);
    const a = take(it, 2), b = take(makers[i](), 5), c = rest(it), d = take(it, 1);
    if (round === 0 || round === 39) log(i, it, it === it[Symbol.iterator](), a, b, c, d, Object.keys(it).length);
  }
  if (round === 20) { map.set("d", 4); map.delete("a"); list.push(9); set.clear(); set.add("new"); empty.set("late", 1); }
}
let older = 0;
for (const it of kept) older += take(it, 3).length;
log(older);
for (let i = 0; i < 20000; i++) { const it = large.keys(); if (it.next().value !== "k0") log("wrong", i); if ((i & 4095) === 0) kept.push(it); }
log(kept.length, take(kept[kept.length - 1], 2));
const it = map.keys(); it.next = () => ({ value: "own", done: false }); log(it.next().value, take(it, 1));
Object.setPrototypeOf(it, null); log(typeof it[Symbol.iterator]);
console.log(out.join("\n"));
