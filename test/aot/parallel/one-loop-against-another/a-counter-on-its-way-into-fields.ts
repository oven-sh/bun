// A counter that nothing bounds is stored into the fields of new objects. One day it no longer fits 32 bits.
// COUNT: operations <= 60
// COUNT: arrivals <= 10
// COUNT: cells <= 5650
// COUNT: branches <= 11400
type Pair = { a: number; b: number };
type Link = { next: Link | null; a: number; b: number };
function make(kept: Pair[], turns: number, start: number) {
  for (let i = start === 0 ? 0 : 2147483000, n = 0; n < turns; i++, n++) kept[n & 1023] = { a: i, b: i };
}
function read(kept: Pair[], turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += kept[turn & 1023]!.a - kept[turn & 1023]!.b + 1;
  return sum;
}
function link(turns: number, start: number) {
  let head: Link | null = null;
  for (let i = start === 0 ? 0 : 2147483000, n = 0; n < turns; i++, n++) head = { next: head, a: i, b: i };
  return head;
}
const [loop = "make past 2 ** 31", turns = "2500"] = process.argv.slice(2);
const start = loop.endsWith("past 2 ** 31") ? 1 : 0;
const kept: Pair[] = [];
for (let index = 0; index < 1024; index++) kept.push({ a: index, b: index });
make(kept, loop.startsWith("make") ? Number(turns) : 2048, start);
const head = link(loop.startsWith("link") ? Number(turns) : 2048, start);
console.log(read(kept, loop.startsWith("read") ? Number(turns) : 1024), kept[5]!.a, head!.a, head!.next!.b);
