// A copy of an array gets named properties right behind its birth, as a list of syntax nodes does. Everything else an array does follows, over collections.
import { edenGC, fullGC } from "bun:jsc";
interface Ranged<T> extends Array<T> { pos: number; end: number; flag: boolean; bits: number }
interface Wide<T> extends Ranged<T> { a: number; b: string; c: T | undefined }
interface Item { v: number }
const ring: unknown[] = new Array(2048).fill(null); let turn = 0;
function churn(n: number) { for (let i = 0; i < n; i++) { ring[turn++ & 2047] = [i, i]; ring[turn++ & 2047] = { a: i, b: i, c: i, d: i, e: i, f: i }; ring[turn++ & 2047] = ranged([{ v: i }], i); } }
function ranged<T>(elements: T[], at: number): Ranged<T> {
  const list = (elements.length >= 1 && elements.length <= 4 ? elements.slice() : elements) as Ranged<T>;
  list.pos = at; list.end = at + elements.length; list.flag = (at & 1) === 1; list.bits = 0;
  return list;
}
function part<T>(elements: T[], from: number, to: number, at: number): Ranged<T> { const list = elements.slice(from, to) as Ranged<T>; list.pos = at; list.end = at + 1; list.flag = false; list.bits = 7; return list; }
function one<T>(elements: T[]): Ranged<T> { const list = elements.slice() as Ranged<T>; list.pos = 5; return list; }
function wide<T>(elements: T[], at: number): Wide<T> { const list = elements.slice() as Wide<T>; list.pos = at; list.end = at; list.flag = true; list.bits = 1; list.a = at; list.b = "b" + at; list.c = elements[0]; return list; }
function sometimes<T>(elements: T[], named: boolean): T[] { const list = elements.slice(); if (named) (list as Ranged<T>).pos = 1; return list; }
const out: string[] = [];
const kept: Ranged<Item>[] = [], keptParts: Ranged<number>[] = [], keptWide: Wide<Item>[] = [], keptOnes: Ranged<string>[] = [], keptSometimes: number[][] = [];
const numbers: number[] = []; for (let i = 0; i < 70; i++) numbers.push(i);
for (let i = 0; i < 4000; i++) {
  const items: Item[] = []; for (let k = 0; k < i % 7; k++) items.push({ v: i * 10 + k });
  kept.push(ranged(items, i)); keptParts.push(part(numbers, i % 60, (i % 60) + (i % 9), i)); keptWide.push(wide(items, i)); keptOnes.push(one(["s" + i])); keptSometimes.push(sometimes([i, i + 1], (i & 3) === 0));
  if (i % 500 === 0) { churn(1500); if (i & 1) edenGC(); else fullGC(); }
}
fullGC(); churn(4000); fullGC();
function check(label: string) {
  let bad = "";
  for (let i = 0; i < 4000 && !bad; i++) {
    const n = i % 7, a = kept[i], p = keptParts[i], w = keptWide[i], o = keptOnes[i], s = keptSometimes[i];
    if (a.pos !== i || a.end !== i + n || a.flag !== ((i & 1) === 1) || a.bits !== 0) bad = "names of " + i;
    for (let k = 0; k < n && !bad; k++) if (a[k].v !== i * 10 + k || w[k].v !== i * 10 + k) bad = "element " + k + " of " + i;
    if (p.pos !== i || p.end !== i + 1 || p.bits !== 7 || p[0] !== (i % 9 ? i % 60 : undefined)) bad = "part " + i;
    if (w.a !== i || w.b !== "b" + i || w.c !== w[0] || w.pos !== i || !w.flag) bad = "wide " + i;
    if (o.pos !== 5 || o[0] !== "s" + i || Object.keys(o).join() !== "0,pos") bad = "one " + i;
    if (s[0] !== i || s[1] !== i + 1 || ("pos" in s) !== ((i & 3) === 0)) bad = "sometimes " + i;
  }
  out.push(label + ": " + bad);
}
check("born");
for (let i = 0; i < 4000; i++) { kept[i].push({ v: -1 }); keptParts[i].push(-1, -2, -3); keptWide[i].unshift({ v: -9 }); keptWide[i].shift(); keptOnes[i].length = 1; keptSometimes[i].push(0); keptSometimes[i].pop(); if (i % 800 === 0) { churn(1000); fullGC(); } }
check("pushed");
let bad = "";
for (let i = 0; i < 4000 && !bad; i++) { const a = kept[i], p = keptParts[i]; if (a.length !== i % 7 + 1 || a[a.length - 1].v !== -1 || p.length !== i % 9 + 3 || p[p.length - 1] !== -3) bad = "lengths of " + i; }
out.push("lengths: " + bad);
for (let i = 0; i < 4000; i++) { (kept[i] as unknown as Record<string, number>).late = i; (keptOnes[i] as unknown as Record<string, number>).end = i; (keptOnes[i] as unknown as Record<string, number>).x1 = 1; (keptOnes[i] as unknown as Record<string, number>).x2 = 2; (keptOnes[i] as unknown as Record<string, number>).x3 = 3; (keptOnes[i] as unknown as Record<string, number>).x4 = 4; }
fullGC(); churn(3000); edenGC();
bad = "";
for (let i = 0; i < 4000 && !bad; i++) { const o = keptOnes[i] as unknown as Record<string, number>; if ((kept[i] as unknown as Record<string, number>).late !== i || o.end !== i || o.x4 !== 4 || o.pos !== 5 || Object.keys(o).join() !== "0,pos,end,x1,x2,x3,x4") bad = "late names of " + i; }
out.push("late names: " + bad);
const f = ranged([1, 2], 3); Object.freeze(f); let threw = false; try { f.pos = 9; } catch { threw = true; } out.push("frozen: " + threw + " " + f.pos + " " + f.join() + " " + JSON.stringify(f) + " " + Object.keys(f).join());
const d = ranged(["a"], 1); delete (d as Partial<Ranged<string>>).end; d.end = 8; delete (d as Partial<Ranged<string>>).pos; out.push("deleted: " + Object.keys(d).join() + " " + d.end + " " + d.pos);
const g = ranged([1.5, 2.5], 1); g[0] = "x" as unknown as number; g[5] = 1; out.push("changed: " + g.join() + " " + g.pos + " " + g.end + " " + g.length);
const c = structuredClone(ranged([1], 2)); out.push("cloned: " + c.join() + " " + (c as Ranged<number>).pos + " " + { ...ranged([7], 2) }.pos + " " + Object.assign([], ranged([7, 8], 2)).end + " " + ranged([3], 1).concat([4]).length + " " + (ranged([3], 1).slice() as Ranged<number>).pos);
Object.defineProperty(ranged([1], 1), "pos", { get() { return 1; } });
const acc = one([1]); Object.defineProperty(acc, "end", { get() { return "got"; }, enumerable: true, configurable: true }); out.push("accessor: " + acc.end + " " + acc.pos + " " + Object.keys(acc).join());
console.log(out.join("\n"));
