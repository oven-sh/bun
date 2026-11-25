// map and filter with written callbacks in loops, over lists of whole numbers that change their kind, their length or their holes under the loop or under the callback.
const told = (v: unknown): string => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, i) => (i in v ? told(v[i]) : "_")).join() + "]" : typeof v === "object" && v ? "{}" : typeof v === "string" ? v : String(v));
const out: string[] = [];
const ints: number[] = [], mixed: number[] = [], doubles: number[] = [], boxed: number[] = [];
for (let i = 0; i < 9; i++) { ints.push(i * 3 - 4); mixed.push(i); doubles.push(i + 0.5); boxed.push(i - 2); }
(boxed as unknown[])[3] = "s"; boxed[3] = 7;
const edges: number[] = [2 ** 31 - 1, -(2 ** 31), 2 ** 31 - 2, 0, -1, 1], holes: number[] = [1, , 3, , 5] as number[], none: number[] = [], long: number[] = [];
for (let i = 0; i < 70; i++) long.push((i * 37) % 64);
let kept: unknown;
const last = (f: () => unknown) => { try { kept = f(); } catch (e) { kept = (e as Error).message ?? e; } return told(kept); };

function plus(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.map(x => x + 1); s += r[i % 9] + r.length; kept = r; } return s; }
function times(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.map((x, k) => x * k); s += r[i % 9]; kept = r; } return s; }
function negated(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = edges.map(x => -x), q = edges.map(x => x * 0), p = edges.map(x => x % 2); s += Object.is(q[4], -0) ? 1 : 0; s += Object.is(r[3], -0) ? 2 : 0; s += Object.is(p[4], -0) ? 1000 : 0; kept = [r, q, p]; } return s; }
function over(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = edges.map(x => x + 1), q = edges.map(x => x - 1), p = edges.map(x => x * x), o = edges.map(x => (x + 1) | 0); s += r[0] + q[1] + p[0] + o[0]; kept = [r, q, p, o]; } return s; }
function halves(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.map(x => x / 2), q = ints.map(x => x * 0.5 + i); s += r[i % 9] + q[2]; kept = [r, q]; } return s; }
function strings(n: number) { let s = ""; for (let i = 0; i < n; i++) { const r = ints.map(x => "n" + x), q = ints.map(x => (x > 2 ? x : undefined)), p = ints.map(x => ({ x })); s = r[i % 9] + q[8] + p[3].x; kept = [r, q]; } return s; }
function odd(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = long.filter(x => x & 1), q = long.filter(x => x > 1000), p = long.filter(() => true), o = long.filter((x, k) => long.indexOf(x) === k); s += r.length + q.length * 7 + p[i % 70] + o.length; kept = [r, p.length, o]; } return s; }
function grown(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.filter(x => x > i % 12); r.push(i % 3 ? 0.5 : i); (r as unknown[]).push(i % 4 ? "t" : i); s += r.length; kept = r; } return s; }
function replaced(n: number) { let t = [1, 2, 3], s = 0; for (let i = 0; i < n; i++) { t = t.map(x => x + 1); if (i % 7 === 6) t = t.filter(x => x & 1).concat([i]); if (i % 11 === 10) t.push(0.5); if (i % 13 === 12) t = [1, 2]; s += t[0] + t.length; } kept = t; return s; }
function kinds(n: number) { const t: number[] = [1, 2, 3, 4]; let s = ""; for (let i = 0; i < n; i++) { if (i === 5) t[1] = 0.5; if (i === 10) t[1] = 2; if (i === 15) (t as unknown[])[2] = "x"; if (i === 20) t[2] = 3; if (i === 25) delete t[3]; if (i === 30) t[9] = 1; if (i === 35) t.length = 2; const r = t.map(x => x + 1), q = t.filter(x => x > 1); if (i % 5 === 1) s += told(r) + told(q); } return s; }
function under(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const t: number[] = [1, 2, 3, 4, 5];
    const r = t.map((x, k) => { if (k === 2) { if (i % 6 === 0) t[4] = 0.25; else if (i % 6 === 1) (t as unknown[])[4] = "u"; else if (i % 6 === 2) t.length = 4; else if (i % 6 === 3) t.push(9); else if (i % 6 === 4) delete t[3]; } return x + 1; });
    const f = t.filter((x, k) => { if (k === 1) { if (i % 5 === 0) t[2] = 0.75; else if (i % 5 === 1) t.pop(); else if (i % 5 === 2) t.unshift(7); } return x > 1; });
    if (i < 12) s += told(r) + told(f) + told(t) + ";";
  }
  return s;
}
function thrown(n: number) { let s = 0; for (let i = 0; i < n; i++) { try { s += ints.map((x, k) => { if (k === i % 12) throw k; return x + 1; }).length; } catch (e) { s += (e as number) * 3; } try { s += ints.filter((x, k) => { if (k === i % 10) throw k; return x > 0; }).length; } catch (e) { s += (e as number) * 5; } if (s > 1e6) break; } return s; }
function nested(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = ints.map(x => mixed.filter(y => y < x).map(y => y + x).length); s += r[i % 9]; kept = r; } return s; }
function others(n: number) { let s = ""; for (let i = 0; i < n; i++) { for (const t of [ints, mixed, doubles, boxed, edges, holes, none, long]) { const r = t.map(x => x + 1), f = t.filter(x => x > 2); if (i === n - 1) s += told(r.length > 20 ? r.slice(0, 5) : r) + told(f.length > 20 ? f.length : f); } } return s; }
function literals(n: number) { let s = 0; for (let i = 0; i < n; i++) { const r = [1, 2, 3].map(x => x * i), q = [4, 5, 6].filter(x => x !== 4 + (i % 3)), frozen = Object.freeze([1, 2, 3]) as readonly number[]; s += r[1] + q[0] + frozen.map(x => x + 1)[2] + frozen.filter(x => x > 1).length; kept = [r, q]; } return s; }
class List extends Array<number> {}
function heirs(n: number) { let s = ""; for (let i = 0; i < n; i++) { const t = List.of(1, 2, 3) as List, r = t.map(x => x + 1), q = t.filter(x => x > 1); s = r.constructor.name + told(r) + q.constructor.name + told(q); } return s; }
for (let round = 0; round < 3; round++) {
  for (const f of [plus, times, negated, over, halves, strings, odd, grown, replaced, kinds, under, thrown, nested, others, literals, heirs]) { out.push(f.name + " " + last(() => f(40 + round))); out.push(told(kept)); }
  if (round === 0) { mixed[4] = 0.5; long.push(2 ** 31); (edges as unknown[]).push(-0); }
  if (round === 1) { (ints as unknown[]).push("end"); holes[1] = 2; none.push(1); }
}
for (const line of out) console.log(line);
export {};
