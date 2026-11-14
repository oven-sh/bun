// Loops that are not unrolled and read arrays of doubles or of int32s: the element that the presence test loads is the one that is read, up to a hole, the end, or a store.
const T = JSON.parse("40") as number, log: number[] = [];
function pushed(p: number[], n: number): number { const out: number[] = []; for (let j = 0; j < n; j++) { out.push(p[j] + 1); if (p[j] > 6) out.push(p[j]); } let s = 0; for (const x of out) s += x; return s; }
function smallest(p: number[], n: number, k: number): number { const out: number[] = [k]; for (let j = 1; j < n; j++) out.push(Math.min(p[j] + 1, out[j - 1] + 1, p[j - 1] + k)); return out[out.length - 1]; }
function split(p: number[], n: number, k: number): number { let s = 0; for (let j = 0; j < n; j++) { if (p[j] > k) s += p[j] * 2; else if (p[j] < 0) s -= p[j]; else log.push(j); } return s; }
function stored(p: number[], n: number): number { let s = 0; for (let j = 1; j < n; j++) { p[j] = p[j] + p[j - 1]; if (p[j] > 1000) { p[j] = 0.5; log.push(p[j]); } s += p[j]; } return s; }
function beside(p: number[], q: number[], n: number): number { let s = 0; for (let j = 0; j < n; j++) { const a = p[j], b = q[j]; s += a < b ? a : b; if (a === b) log.push(j); } return s; }
function rows(m: number[][], p: number[], n: number): number { let s = 0; for (let i = 0; i < m.length; i++) { const row: number[] = []; for (let j = 0; j < n; j++) row.push(m[i][j] + p[j]); for (const x of row) s += x; } return s; }
const makers: (() => number[])[] = [
  () => Array.from({ length: 14 }, (_, i) => i), () => Array.from({ length: 14 }, (_, i) => i * 1.5), () => Array.from({ length: 14 }, (_, i) => i & 1 ? i : i + 0.25), () => Array.from({ length: 14 }, (_, i) => 3 - i), () => Array.from({ length: 14 }, (_, i) => i % 3 ? -0 : 0),
  () => Array.from({ length: 14 }, (_, i) => i * 900000000), () => [1, 2, NaN, 4, 5, 6, 7, 8], () => { const list = [1, 2, 3, 4, 5, 6]; delete list[4]; return list; }, () => { const list = [1.5, 2.5, 3.5, 4]; delete list[1]; return list; }, () => [], () => { const list = [1, 2, 3]; list.length = 20; return list; },
];
const show = (v: number): string => Object.is(v, -0) ? "-0" : String(v);
for (let t = 0; t < T; t++) {
  const said: string[] = [];
  for (const first of makers) for (const second of makers) {
    const n = t % 5 === 3 ? 17 : 14, p = first(), q = t % 4 === 2 ? second().map(x => x / 2) : second();
    said.push(show(pushed(p, n)), show(smallest(p, n, t % 7)), show(split(p, n, t % 7)), show(beside(p, q, n)), show(rows([p, q, first()], p, n)), show(stored(p, n)));
  }
  if (t < 6 || t === T - 1) console.log(said.join(), log.length, log.slice(-20).join());
}
