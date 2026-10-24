// The outer object is named by nobody any more while fields of the object that lies in it are still read and stored, with allocations and collections in between.
type Inner = { count: number; label: string; list: number[] };
type Outer = { inner: Inner; tag: number };
type Box = { it: Outer | null };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i, list: [i, i + 1] }, tag: i });
    }
  }
}

let junk: unknown = null;
function readsOverAllocations(box: Box): number {
  const x = box.it!;
  box.it = null;
  const c = x.inner;
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    junk = { i, j: [i] };
    sum += c.count + c.list[1] + c.label.length;
  }
  return sum;
}
function storesOverAllocations(box: Box): string {
  const x = box.it!;
  box.it = null;
  const c = x.inner;
  for (let i = 0; i < 3000; i++) {
    junk = [i, { i }];
    c.count += 1;
    c.list = [i, c.count];
    c.label = "l" + i;
  }
  return c.count + " " + c.list.join() + " " + c.label;
}

const held: Inner[] = [];
function hold(outer: Outer): void { held.push(outer.inner); }

const lines: string[] = [];
for (let round = 0; round < 6; round++) {
  const some: Outer[] = [];
  fill(some, 6, 6);
  const first: Box = { it: some[round] }, second: Box = { it: some[round + 10] };
  hold(some[round + 20]);
  some.length = 0;
  lines.push(readsOverAllocations(first) + " " + storesOverAllocations(second));
}
console.log(lines.join(" | "), held.map(inner => inner.count + inner.label).join());
