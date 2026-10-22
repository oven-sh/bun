// One fresh object listed by two allocations, in a loop, in arms of a branch: at most one may take the cell. Each case has layouts of its own.
interface I1 { d1: number } interface O1 { b1: number; c1: I1 }
interface I2 { d2: number } interface O2 { b2: number; c2: I2 }
interface I3 { d3: number } interface O3 { b3: number; c3: I3 }
interface I4 { d4: number } interface O4 { b4: number; c4: I4 }
interface I5 { d5: number } interface O5 { b5: number; c5: I5 } interface P5 { a5: number; e5: I5 }
const keep: any[] = [];
function twice(i: number): [O1, O1] { const c: I1 = { d1: i }; const p: O1 = { b1: 1, c1: c }; keep[i & 63] = p; const q: O1 = { b1: 2, c1: c }; keep[(i + 1) & 63] = q; return [p, q]; }
function inLoop(i: number): O2[] { const c: I2 = { d2: i }; const r: O2[] = []; for (let k = 0; k < 3; k++) r.push({ b2: k, c2: c }); return r; }
function arms(i: number): O3 { const c: I3 = { d3: i }; keep[i & 63] = c; return i & 1 ? { b3: 1, c3: c } : { b3: 2, c3: c }; }
function maybe(i: number): I4 | O4 { const c: I4 = { d4: i }; keep[i & 63] = c; if (i & 1) return c; return { b4: 3, c4: c }; }
function twoLayouts(i: number): [O5, P5] { const c: I5 = { d5: i }; const p: O5 = { b5: 1, c5: c }; keep[i & 63] = p; const q: P5 = { a5: 2, e5: c }; keep[(i + 1) & 63] = q; return [p, q]; }
let s = 0;
for (let i = 0; i < 30000; i++) {
  const [p, q] = twice(i); p.c1.d1++; s += q.c1.d1 + p.b1 + q.b1 + (p.c1 === q.c1 ? 1 : 0) + (p === (q as any) ? 1000 : 0);
  const l = inLoop(i); l[0].c2.d2 += 2; s += l[2].c2.d2 + l[1].b2 + l[0].b2 + l[2].b2;
  const x = arms(i); s += x.c3.d3 + x.b3;
  const m: any = maybe(i); s += m.d4 ?? m.c4.d4 + m.b4;
  const [u, v] = twoLayouts(i); u.c5.d5 += 3; s += v.e5.d5 + u.b5 + v.a5 + (u.c5 === v.e5 ? 1 : 0);
  if (i % 5000 === 0) Bun.gc(true);
}
console.log(s, JSON.stringify(keep[5]), JSON.stringify(keep[6]));
