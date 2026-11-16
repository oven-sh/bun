// Generators that one loop or one spread alone holds: over a count, over a list, under a finally, left early, spread.
// Sizes: 1000 4000 16000
// Passes: 77
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
let closed = 0;
function* upTo(count: number): Generator<number> {
  for (let i = 0; i < count; i++) yield i & 15;
}
function* doubled(list: number[]): Generator<number> {
  for (const item of list) yield item * 2;
}
function* guarded(count: number): Generator<number> {
  try {
    for (let i = 0; i < count; i++) yield i & 7;
  } finally {
    closed++;
  }
}
function* endless(): Generator<number> {
  for (let i = 0; ; i++) yield i & 3;
}
function* pairs(count: number): Generator<number> {
  for (let i = 0; i < count; i++) {
    yield i & 1;
    yield i & 2;
  }
}
function once(): string {
  const list: number[] = [];
  for (let i = 0; i < size; i++) list.push(i & 31);
  let sum = 0;
  for (const x of upTo(size)) sum += x;
  for (const x of doubled(list)) sum += x;
  for (const x of guarded(size)) sum += x;
  let turns = 0;
  for (const x of endless()) {
    if (++turns > size) break;
    sum += x;
  }
  for (const x of guarded(size)) {
    if (x === 7) break;
    sum += x;
  }
  sum += [...pairs(size)].length;
  return [sum, closed & 1].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
