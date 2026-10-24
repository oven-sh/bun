// Nothing but the inner object names what it holds, and the inner object lies in the outer one. The collector has to find it there. What it misses is overwritten: the program makes look-alikes by the hundred thousand behind each collection.
class Leaf { v: number; w: number; constructor(v: number, w: number) { this.v = v; this.w = w; } }
// A field that holds objects of two layouts has no room for either, so the leaves have cells of their own.
class LeafWithName extends Leaf { name = "leaf"; }
interface Inner { r: Leaf; s: string; t: Leaf | null; n: number }
interface Outer { a: Inner; id: number }
const N = 30000;
const kept: Outer[] = [];
const held: Inner[] = [];
const trash: unknown[] = new Array(512);
function make(i: number): Outer { return { a: { r: i % 100 ? new Leaf(i, -i) : new LeafWithName(i, -i), s: "s" + i, t: i & 1 ? (i % 99 ? new Leaf(-i, i) : new LeafWithName(-i, i)) : null, n: i }, id: i }; }
function churn(n: number): number {
  let length = 0;
  for (let i = 0; i < n; i++) {
    trash[i & 511] = i & 1023 ? new Leaf(-1, -1) : new LeafWithName(-1, -1);
    length += ("x" + i).length;
  }
  return length;
}
function isWrong(x: Outer): number {
  let count = 0;
  if (x.a.r.v !== x.id || x.a.r.w !== -x.id || x.a.s !== "s" + x.id || x.a.n !== x.id) count++;
  if (x.id & 1 ? x.a.t === null || x.a.t.v !== -x.id : x.a.t !== null) count++;
  return count;
}
function wrong(): number {
  let count = 0;
  for (let i = 0; i < kept.length; i++) count += isWrong(kept[i]);
  return count;
}
// Somebody holds an inner object, a few times, so the field stays.
function hold(i: number) { held.push(kept[i].a); }

for (let part = 0; part < 3; part++) for (let half = 0; half < 2; half++) for (let i = 0; i < N / 6; i++) kept.push(make(kept.length));
const lines: string[] = [];
for (let round = 0; round < 4; round++) {
  Bun.gc(true);
  const length = churn(150000);
  lines.push(round + " " + wrong() + " " + length);
}
hold(0); hold(7); hold(14); hold(21);
Bun.gc(true);
churn(150000);
console.log(lines.join("\n"));
console.log(wrong(), held.map(inner => inner.r.v + inner.s).join(), held.every((inner, i) => inner === kept[i * 7].a));
