// The inner object is read out of one field and stored into another, with collections between, and nobody else holds it or its outer object meanwhile.
interface Inner { d: number; s: string }
interface Outer { b: number; c: Inner }
interface Holder { c: Inner | null; n: number }
function make(i: number): Outer { return { b: i, c: { d: i, s: "s" + i } }; }
const sources: (Outer | null)[] = [];
const ring: (Outer | null)[] = new Array(2048).fill(null);
function dropAndCollect(index: number, from: number): number {
  sources[index] = null;
  Bun.gc(true);
  let x = 0;
  for (let i = 0; i < 5000; i++) { const o = make(from + i); ring[i & 2047] = o; x += o.b & 1; }
  ring.fill(null);
  return x;
}
function carry(index: number, to: Holder): void {
  const x = sources[index]!.c;
  to.n += dropAndCollect(index, 3000000 + index * 10000);
  to.c = x;
}
const holders: Holder[] = [];
for (let i = 0; i < 16; i++) { sources.push(make(i)); holders.push({ c: null, n: 0 }); }
for (let i = 0; i < 16; i++) carry(i, holders[i]);
let bad = "";
for (let i = 0; i < 16; i++) { const c = holders[i].c!; if (c.d !== i || c.s !== "s" + i) { bad = "WRONG at " + i + ": " + c.d + " " + c.s; break; } }
console.log("done", bad);
