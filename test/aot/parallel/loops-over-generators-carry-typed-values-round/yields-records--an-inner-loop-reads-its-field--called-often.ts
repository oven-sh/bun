class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function* each(list: Item[], flag: boolean): Generator<{ weight: number; skip: boolean }> { if (flag) yield { weight: 4, skip: false }; for (const one of list) yield { weight: one.weight, skip: one.skip }; }
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  for (const one of each(list, flag)) { if (one === null) continue; for (let i = 0; i < times; i++) sum = (sum + one.weight) | 0; }
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, flag) + " ";
}
console.log(last);
