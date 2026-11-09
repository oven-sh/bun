let tally = 0;
class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
  twice(): number { return this.weight * 2; }
}
function* pick(flag: boolean): Generator<number> { for (let i = 0; i < 2; i++) yield i; for (let j = 0; j < (flag ? 2 : 1); j++) yield 10 + j; }
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  const other = list[(at + 1) % list.length];
  if (item.skip) return -1;
  const first = item.weight;
  if (first > 90) return -2;
  let sum = work;
  for (const x of pick(flag)) {
    for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; for (let j = 0; j < times; j++) sum = (sum + other.weight + item.weight) | 0; sum = (sum + x) | 0;
  }
  
  return sum;
}
const stranger = JSON.parse('{"skip":false,"weight":3}'); stranger.twice = function () { return this.weight * 2; };
const items: Item[] = [new Item(false, 2), stranger, new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, flag) + " ";
}
console.log(last + tally);
