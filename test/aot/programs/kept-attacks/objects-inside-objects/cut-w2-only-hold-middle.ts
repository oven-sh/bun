// Three levels: the innermost may lie in a room of the middle one, and the middle one in the cell of the outermost. Everything is kept, dropped, held and stored over while the collector runs.
// Whatever wants an inner object as a value stands in functions that are called a few times from the top, so that the compiler takes such places for rare.
interface Leaf { v: number; text: string }
interface Inner { b: number; r: Leaf | null; s: Leaf | null }
interface Middle { a: Inner; n: number }
interface Outer { p: Middle; k: number }
function leaf(i: number): Leaf { return { v: i, text: "t" + (i % 7) }; }
function make(i: number): Outer { return { p: { a: { b: i, r: leaf(i), s: null }, n: i + 1 }, k: i + 2 }; }
function garbage(n: number): number { let s = 0; for (let i = 0; i < n; i++) { const t = [i, i + 1, { q: i }]; s += t.length; } return s; }
const N = 30000;
const all: (Outer | null)[] = [];
for (let i = 0; i < N; i++) all.push(make(i));
const heldInner: Inner[] = [], heldMiddle: Middle[] = [], heldLeaf: Leaf[] = [];
let sum = 0;
function work(round: number): void {
  for (let i = 0; i < N; i++) {
    const o = all[i];
    if (!o) continue;
    const m = o.p;
    sum += m.a.b + (m.a.r ? m.a.r.v : 0) + m.n + o.k;
    const what = (i + round) % 5;
    if (what === 0) sum += 1;
    else if (what === 1) m.a = { b: -i, r: leaf(-i), s: null };      // the room is filled again
    else if (what === 2) m.a.r = null;
    else if (what === 3) { all[i] = (i & 63) ? o : null; sum += garbage(4); sum += m.a.b + (m.a.s ? m.a.s.v : 1); }   // nothing else may name the outer ones while the collector runs
  }
}
function holdInner(i: number): void { const o = all[i]; if (o) heldInner.push(o.p.a); }
function holdMiddle(i: number): void { const o = all[i]; if (o) { heldMiddle.push(o.p); all[i] = null; } }
function giveHeld(i: number, j: number): void { const o = all[i]; if (o && heldInner.length) o.p.a = heldInner[j % heldInner.length]; }
function few(k: number): void {
  holdMiddle(k * 41 + 5); holdMiddle(k * 89 + 6); holdMiddle(k * 307 + 7);
}
work(0); few(1); Bun.gc(true); work(1); few(2); sum += garbage(3000); work(2); few(3); Bun.gc(true); work(3); few(4); work(4); few(5); Bun.gc(true); work(5); few(6);
for (const c of heldInner) sum += c.b + (c.r ? c.r.v + c.r.text.length : 0) + (c.s ? c.s.v : 0);
for (const m of heldMiddle) sum += m.n + m.a.b + (m.a.r ? m.a.r.text.length : 0);
for (const l of heldLeaf) sum += l.v + l.text.length;
console.log(sum, heldInner.length, heldMiddle.length, heldLeaf.length, all.filter(Boolean).length);
