class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function* each(list: Item[], flag: boolean): Generator<Item> { if (flag) yield list[0]; yield list[1]; for (const one of list) yield one; }
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  for (const one of each(list, flag)) { if (one === null) continue; const before = one.weight; for (let i = 0; i < times; i++) one.weight = (one.weight + i) | 0; sum = (sum + one.weight) | 0; one.weight = before; }
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
console.log(drive(items, process.argv.length > 99 ? 1 : 2, 3, process.argv.length < 99));
