class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function* each(list: Item[], flag: boolean): Generator<Item | null> { yield list[0]; if (flag) yield null; yield list[2]; }
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  let read: (() => number) | null = null; for (const one of each(list, flag)) { if (one !== null && one.weight > 2) { read = () => one.weight * 2; break; } } sum = (sum + (read === null ? -5 : read())) | 0;
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, flag) + " ";
}
console.log(last);
