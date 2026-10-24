// The outer object is taken out of the only place that names it and its inner object is read. Then the function allocates, and reads and stores through the inner object. Nothing but that name is left of the pair, and the collector has to keep the pair for it.
// What it frees is overwritten: the function makes objects of the sizes that the outer object may have.
class Leaf { v: number; constructor(v: number) { this.v = v; } }
// A field that holds objects of two layouts has no room for either, so the leaves have cells of their own.
class LeafWithName extends Leaf { name = "leaf"; }
interface Inner { b: number; r: Leaf; n: number }
interface Outer { a: Inner; id: number }
interface Small { p0: number; p1: number }
interface Middle { q0: number; q1: number; q2: number; q3: number }
interface Large { r0: number; r1: number; r2: number; r3: number; r4: number; r5: number }
let small: Small | null = null, middle: Middle | null = null, large: Large | null = null;
function make(i: number): Outer { return { a: { b: i, r: i % 50 ? new Leaf(i) : new LeafWithName(i), n: -i }, id: i }; }
function takeAndRead(all: (Outer | null)[], i: number): number {
  const x = all[i]!;
  all[i] = null;
  const c = x.a;
  const before = c.b;
  for (let k = 0; k < 12; k++) {
    small = { p0: -7, p1: -7 };
    middle = { q0: -7, q1: -7, q2: -7, q3: -7 };
    large = { r0: -7, r1: -7, r2: -7, r3: -7, r4: -7, r5: -7 };
  }
  c.n += 1;
  for (let k = 0; k < 12; k++) {
    small = { p0: -9, p1: -9 };
    middle = { q0: -9, q1: -9, q2: -9, q3: -9 };
    large = { r0: -9, r1: -9, r2: -9, r3: -9, r4: -9, r5: -9 };
  }
  return c.b === before && c.n === 1 - before && c.r.v === before ? 0 : 1;
}
let wrong = 0;
const all: (Outer | null)[] = [];
for (let round = 0; round < 40; round++) {
  all.length = 0;
  for (let part = 0; part < 10; part++) for (let i = 0; i < 500; i++) all.push(make(part * 500 + i));
  for (let i = 0; i < all.length; i++) wrong += takeAndRead(all, i);
}
console.log(wrong, small!.p0 + middle!.q0 + large!.r0);
