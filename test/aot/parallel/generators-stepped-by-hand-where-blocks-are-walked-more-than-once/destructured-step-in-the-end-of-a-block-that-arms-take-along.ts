type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
class Item { seen = 0; last = -1; weight: number; constructor(weight: number) { this.weight = weight; } }
function take(items: Item[], at: number, walk: Walk): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = items[at];
  item.seen = item.seen + 1;
  const { value, done } = walk.next(item.weight);
  item.last = at;
  if (done) return 1000 + value;
  return value + work;
}
const items: Item[] = [new Item(2), JSON.parse('{"seen":0,"last":-1,"weight":3}'), new Item(5)];
let last = "";
for (let round = 0; round < 300; round++) {
  const walk = walkOf(4);
  const line: number[] = [];
  for (let at = 0; at < 5; at++) line.push(take(items, at % 3, walk));
  last = line.join();
}
console.log(last);
