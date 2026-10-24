// Loops hold on to the elements of an array while nothing else names the array, and collections run in the loop.
import { edenGC, fullGC } from "bun:jsc";
interface Item { v: number; next: Item | null }
const ring: unknown[] = new Array(4096).fill(null); let turn = 0;
function churn(n: number) { for (let i = 0; i < n; i++) { ring[turn++ & 4095] = [i, i, i]; ring[turn++ & 4095] = [{ v: i, next: null }]; ring[turn++ & 4095] = { a: i, b: i, c: i, d: i }; } }
function make(n: number): Item[] { const a: Item[] = []; for (let i = 0; i < n; i++) a.push({ v: i, next: null }); return a; }
function literal(i: number): Item[] { return [{ v: i, next: null }, { v: i + 1, next: null }, { v: i + 2, next: null }]; }
function sumOver(a: Item[], every: number): number { let t = 0; for (let i = 0; i < a.length; i++) { t += a[i].v; if (i % every === 0) { churn(600); if (i & 1) edenGC(); else fullGC(); } } return t; }
function sumOf(a: Item[], every: number): number { let t = 0, i = 0; for (const x of a) { t += x.v; if (i++ % every === 0) { churn(600); fullGC(); } } return t; }
let total = 0;
for (let round = 0; round < 12; round++) {
  total += sumOver(make(3 + round * 5), 4) + sumOf(make(1 + round * 7), 5) + sumOver(literal(round), 1) + sumOf(literal(round).slice(1), 1) + sumOver(literal(round).concat(literal(round + 10)), 2) + sumOf(make(9).map(x => ({ v: x.v * 2, next: x })), 2);
  literal(round).forEach((x, i) => { churn(300); fullGC(); total += x.v + i; });
  total += literal(round).reduce((t, x) => { churn(300); edenGC(); return t + x.v; }, 0);
  const [a, b, c] = literal(round); churn(300); fullGC(); total += a.v + b.v + c.v;
}
console.log(total);
