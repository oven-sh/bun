// A copy of a source with an optional member has two shapes, and they meet in a join right after the spread's rare generic path comes back.
// The copies are only read, so the common path must not allocate.
// COUNT: branches >= 1
// COUNT: cells <= 1000
interface O {
  a: number;
  b?: number;
  c: number;
}
const p: O = { a: 1, b: 2, c: 3 };
const q: O = { a: 4, c: 6 };
const both: O[] = [p, q];
function copied(i: number): number {
  const c = { ...both[i & 1] };
  return c.a + (c.b ?? 0) + c.c + (i & 7);
}
function replaced(i: number): number {
  const c = { ...(i & 1 ? p : q), a: i & 7 };
  return c.a + (c.b ?? 0) + c.c;
}
let sum = 0;
for (let i = 0; i < 70000; i++) sum += copied(i) + replaced(i);
console.log(sum);
