// A module body and a function that is called once run once, and the loops in them do not: what a large function returns there is read, kept, compared and changed like any other object.
type Point = { x: number; y: number };
let noise = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function pads(): void { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); pad(9); pad(10); pad(11); pad(12); }

function make(a: number, b: number): Point { pads(); pad(a); pad(b); return { x: a + b, y: a - b }; }
// Too large to be inlined, and it returns what `make` returns.
function forwards(a: number): Point { pads(); pad(a); pad(a + 1); pad(a + 2); return make(a, a + 1); }
function forwardsOrNull(a: number): Point | null { pads(); pad(a); if (a % 3 === 0) return null; return make(a, 2); }

let read = 0;
for (let i = 0; i < 50; i++) { const p = forwards(i); read += p.x * 2 - p.y; }
console.log("read at the top level", read);

const kept: Point[] = [];
let previous: Point | null = null;
let same = 0;
for (let i = 0; i < 20; i++) {
  const p = forwards(i);
  if (p === previous) same++;
  previous = p;
  if (i % 4 === 0) kept.push(p);
}
for (const p of kept) p.x++;
console.log("kept at the top level", same, kept.length, kept.map(p => p.x + ":" + p.y).join(" "), new Set(kept).size);

function main(n: number): string {
  let sum = 0, nulls = 0;
  for (let i = 0; i < n; i++) {
    const p = forwardsOrNull(i);
    if (p === null) { nulls++; continue; }
    p.y += i;
    sum += p.x + p.y;
  }
  const once = forwards(n);
  let last = once;
  for (let i = 0; i < n; i++) { const p = forwards(i); if (p.x > last.x) last = p; }
  return [sum, nulls, once.x, once.y, last.x, last.y, last === once, Object.keys(last).join()].join(" ");
}
console.log("in a function that is called once", main(30));
console.log(noise);
