type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
class Item { skip: boolean; weight: number; constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; } }
function take(items: Item[], at: number, walk: Walk): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = items[at];
  if (item.skip) return -1;
  const { value, done } = walk.next(item.weight);
  if (done) return 1000 + value;
  return value + work;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":true,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  const walk = walkOf(3);
  const line: number[] = [];
  for (let at = 0; at < 6; at++) line.push(take(items, at % 3, walk));
  last = line.join();
}
console.log(last);
