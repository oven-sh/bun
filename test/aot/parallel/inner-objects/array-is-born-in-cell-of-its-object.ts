// An object is born with a short array literal in a field. Everything an array can do is done to it, over collections.
import { edenGC, fullGC } from "bun:jsc";
interface Item { v: number; s: string }
class Bag {
  items: Item[];
  numbers: number;
  name: string;
  constructor(name: string) { this.items = []; this.numbers = 0; this.name = name; }
}
interface Pair { list: number[]; tag: string }
interface Mixed { list: (number | string | Item)[]; tag: string }
function makePair(i: number): Pair { return { list: [i, i + 1, i + 2], tag: "p" + i }; }
function makeMixed(i: number): Mixed { return { list: [i, "s" + i, { v: i, s: "m" + i }], tag: "x" + i }; }
const bags: Bag[] = [];
const ring: (Bag | Pair | Mixed | null)[] = new Array(1024).fill(null);
function churn(from: number): number {
  let x = 0;
  for (let i = 0; i < 4000; i++) { const b = new Bag("c" + (from + i)); b.items.push({ v: -i, s: "c" }); ring[i & 1023] = b; x += b.items.length; ring[(i + 1) & 1023] = makePair(from - i); ring[(i + 2) & 1023] = makeMixed(from - i); }
  return x;
}
const out: string[] = [];
// Grows from nothing beyond the first storage, with young elements in an old array.
for (let i = 0; i < 300; i++) bags.push(new Bag("b" + i));
fullGC();
for (let round = 0; round < 12; round++) {
  for (let i = 0; i < bags.length; i++) bags[i].items.push({ v: round * 1000 + i, s: "r" + round });
  churn(round * 100000);
  if (round & 1) edenGC(); else fullGC();
}
let bad = "";
for (let i = 0; i < bags.length && !bad; i++) {
  const b = bags[i];
  if (b.items.length !== 12 || b.name !== "b" + i) bad = "length of " + i + ": " + b.items.length;
  for (let r = 0; r < 12 && !bad; r++) if (b.items[r].v !== r * 1000 + i || b.items[r].s !== "r" + r) bad = "element " + r + " of " + i + ": " + b.items[r].v + b.items[r].s;
}
out.push("grown: " + bad);
// The array outlives the object.
const lists: number[][] = [];
const mixedLists: (number | string | Item)[][] = [];
for (let i = 0; i < 3000; i++) { const p = makePair(i); ring[i & 1023] = p; if (i % 5 === 0) lists.push(p.list); const m = makeMixed(i); ring[(i + 7) & 1023] = m; if (i % 5 === 0) mixedLists.push(m.list); }
ring.fill(null);
for (let round = 0; round < 4; round++) { fullGC(); churn(5000000 + round * 100000); ring.fill(null); }
bad = "";
for (let k = 0; k < lists.length && !bad; k++) {
  const l = lists[k], m = mixedLists[k], i = k * 5;
  if (l.length !== 3 || l[0] !== i || l[1] !== i + 1 || l[2] !== i + 2) bad = "numbers " + k + ": " + l.join();
  if (m.length !== 3 || m[0] !== i || m[1] !== "s" + i || (m[2] as Item).v !== i || (m[2] as Item).s !== "m" + i) bad = "mixed " + k + ": " + JSON.stringify(m);
}
out.push("outlives: " + bad);
// What arrays do.
const p = makePair(10);
const alias = p.list;
p.list.push(13, 14, 15, 16, 17, 18);
out.push("push: " + alias.join() + " " + (alias === p.list) + " " + alias.length);
alias.length = 2; out.push("shrunk: " + p.list.join() + " " + p.list.length);
alias.length = 0; alias.push(1); out.push("emptied: " + p.list.join());
const q = makePair(20);
q.list[1] = 0.5; out.push("fraction: " + q.list.join());
(q.list as unknown as (number | string)[])[2] = "text"; out.push("text: " + q.list.join());
q.list[9] = 9; out.push("hole: " + q.list.join() + " " + q.list.length + " " + (5 in q.list));
const r = makePair(30);
(r.list as unknown as { extra: string }).extra = "named"; out.push("named: " + (r.list as unknown as { extra: string }).extra + " " + Object.keys(r.list).join());
r.list.unshift(-1, -2); r.list.splice(1, 2, 7, 8, 9); r.list.reverse(); r.list.sort((a, b) => a - b); out.push("moved: " + r.list.join());
const s = makePair(40);
Object.freeze(s.list); let threw = false; try { s.list.push(1); } catch { threw = true; } out.push("frozen: " + threw + " " + s.list.join() + " " + Object.isFrozen(s.list));
const t = makePair(50);
out.push("copies: " + JSON.stringify(t) + " " + JSON.stringify({ ...t }) + " " + [...t.list].join() + " " + ({ ...t }.list === t.list) + " " + structuredClone(t).list.join() + " " + Array.isArray(t.list));
const other = [1, 2]; t.list = other; out.push("pointed elsewhere: " + t.list.join() + " " + (t.list === other));
const u = makeMixed(60); const [a0, a1, a2] = u.list; out.push("destructured: " + a0 + a1 + (a2 as Item).s + " " + u.list.indexOf("s60") + " " + u.list.includes(60) + " " + u.list.map(x => typeof x).join() + " " + u.list.concat([1]).length + " " + u.list.slice(1).length);
const w = new WeakRef(makePair(70).list); const wm = new WeakMap<object, number>(); const kept = makePair(71); wm.set(kept.list, 5); fullGC(); out.push("weak: " + wm.get(kept.list) + " " + (w.deref() === undefined || w.deref()!.length === 3));
console.log(out.join("\n"));
