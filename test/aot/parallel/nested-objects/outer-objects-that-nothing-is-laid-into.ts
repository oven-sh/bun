// Outer objects that are born with null, with undefined or with an object that has a cell, in cells that held other things before. The collector looks into the room whatever the slot says, so the room must not hold what was there.
interface Leaf { v: number }
interface Inner { r: Leaf | null; s: Leaf | null; t: Leaf | null; n: number }
interface Outer { a: Inner | null | undefined; id: number }
const shared: Inner = { r: { v: 1 }, s: null, t: null, n: 1 };
const kept: Outer[] = [];
let junk: unknown[] = [];
function laid(i: number): Outer { return { a: { r: { v: i }, s: null, t: { v: -i }, n: i }, id: i }; }
function nulled(i: number): Outer { return { a: null, id: i }; }
function missing(i: number): Outer { return { a: undefined, id: i }; }
function given(i: number): Outer { return { a: shared, id: i }; }
// Numbers that are no references, in cells of every size that the outer object may have.
function fillCells(n: number) {
  const big = 0x7ffffff0, fraction = 1.5e300;
  for (let i = 0; i < n; i++) {
    junk.push({ a1: big, b1: big }, { a2: big, b2: big, c2: big, d2: big }, { a3: fraction, b3: fraction, c3: fraction, d3: fraction });
    junk.push({ a4: big, b4: big, c4: big, d4: big, e4: big, f4: big, g4: big, h4: big }, { a5: fraction, b5: fraction, c5: fraction, d5: fraction, e5: fraction, f5: fraction });
    junk.push({ a6: big, b6: big, c6: big, d6: big, e6: big, f6: big, g6: big, h6: big, i6: big, j6: big, k6: big, l6: big });
  }
}
function read(x: Outer): number { return x.id + (x.a ? x.a.n + (x.a.r ? x.a.r.v : 0) + (x.a.t ? x.a.t.v : 0) : x.a === null ? 1 : 2); }
function few(k: number) { for (let i = 0; i < 3000; i++) kept.push(nulled(k + i), missing(k + i), given(k + i)); }

let sum = 0;
for (let round = 0; round < 3; round++) {
  fillCells(6000);
  junk = [];
  Bun.gc(true);
  few(round);
  for (let part = 0; part < 4; part++) for (let i = 0; i < 4000; i++) { const x = laid(i); if ((i & 7) === 0) kept.push(x); sum += read(x); }
  Bun.gc(true);
  Bun.gc(true);
  for (const x of kept) sum += read(x);
}
console.log(sum, kept.length);
