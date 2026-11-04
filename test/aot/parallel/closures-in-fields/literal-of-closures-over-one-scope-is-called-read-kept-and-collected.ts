// An object of closures over the scope that made it. Its closures are made when somebody reads them as values, and a call through a field needs none: whichever comes first, the program sees one function object a field and the one scope.
type Counter = { add: (by: number) => number; get: () => number; reset: () => void; twice: () => number };
function makeCounter(start: number): Counter {
  let n = start;
  return {
    add: (by: number) => (n += by),
    get: () => n,
    reset: () => {
      n = start;
    },
    twice: () => n * 2,
  };
}
const kept: Counter[] = [];
for (let i = 0; i < 50; i++) kept.push(makeCounter(i));
function sum(list: Counter[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    c.add(1);
    total += c.get() + c.twice();
  }
  return total;
}
console.log(sum(kept), sum(kept));
const read = kept[7].get;
console.log(read === kept[7].get, read(), typeof kept[8].twice, kept[7].get !== kept[8].get);
Bun.gc(true);
console.log(sum(kept), kept[11].get(), read === kept[7].get, read());
kept[7].reset();
console.log(read(), kept[7].twice(), kept[7].add(5), read());
