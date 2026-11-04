// The first read of a method as a value makes its closure and stores it into the object. An object that has lived through a collection is an old one: the store runs the barrier, and what the read hands on comes from behind it.
type Counter = { add: (by: number) => number; get: () => number; twice: () => number };
function makeCounter(start: number): Counter {
  let n = start;
  return { add: (by: number) => (n += by), get: () => n, twice: () => n * 2 };
}
function take(c: Counter, which: number): () => number {
  return which ? c.twice : c.get;
}
function apart(c: Counter): number {
  const { add, get, twice } = c;
  return inner();
  function inner(): number {
    return add(1) + get() + twice();
  }
}
const kept: Counter[] = [];
for (let i = 0; i < 64; i++) kept.push(makeCounter(i));
Bun.gc(true);
Bun.gc(true);
let total = 0;
for (let i = 0; i < 32; i++) {
  const late = take(kept[i], i & 1);
  total += late() + (late === take(kept[i], i & 1) ? 1000 : 0);
}
for (let i = 32; i < 64; i++) total += apart(kept[i]);
console.log(total);
