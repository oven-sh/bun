// Array literals of one to five integers: int32 values, the int32 limits, integers beyond int32, and what later stores do to them.
const out: string[] = [];
const show = (label: string, list: unknown[]) => out.push(`${label}: ${list.length} ${JSON.stringify(list)} ${list.map(value => Object.is(value, -0)).join()}`);

function one(a: number): number[] {
  return [a | 0];
}
function two(a: number, b: number): number[] {
  return [a | 0, b | 0];
}
function three(a: number, b: number, c: number): number[] {
  return [a | 0, b | 0, c | 0];
}
function four(a: number, b: number, c: number, d: number): number[] {
  return [a | 0, b | 0, c | 0, d | 0];
}
function five(a: number, b: number, c: number, d: number, e: number): number[] {
  return [a | 0, b | 0, c | 0, d | 0, e | 0];
}
function beyondInt32(start: number): number[] {
  const list: number[][] = [];
  for (let i = start; i < start + 3; i++) list.push([i, i + 1, i + 2]);
  return list.flat();
}

const limits = [0, 1, -1, 2147483647, -2147483648, 4294967295, 65536, -65536];
for (const a of limits) {
  show("one", one(a));
  show("two", two(a, -a));
  show("three", three(a, a + 1, a - 1));
  show("four", four(a, ~a, a >> 1, a >>> 1));
  show("five", five(a, 1, 2, 3, -a));
}
show("beyond", beyondInt32(2147483645));
show("below", beyondInt32(-3));

// The literal has room for more, takes other kinds of values, and is no copy of another literal of its site.
const first = three(1, 2, 3);
const second = three(1, 2, 3);
first.push(4, 5, 6, 7);
first[1] = 0.5;
show("grown", first);
show("untouched", second);
(second as unknown[])[0] = "text";
second.length = 2;
show("mixed", second);
const sparse = two(7, 8);
sparse[5] = 9;
show("sparse", sparse);
show("reversed", four(1, 2, 3, 4).reverse());
show("sorted", four(4, -3, 2, -1).sort((x, y) => x - y));

// Many literals, so that the allocator runs out of cells again and again.
let sum = 0;
const kept: number[][] = [];
for (let i = 0; i < 200000; i++) {
  const list = i & 1 ? three(i, -i, i >> 3) : two(i, i ^ 5);
  kept[i & 63] = list;
  sum += list[list.length - 1]! + kept[(i * 7) & 63 & (i < 64 ? 0 : 63)]![0]!;
}
out.push(`sum ${sum} ${kept.length} ${JSON.stringify(kept[63])}`);
console.log(out.join("\n"));
