class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function* each(list: Item[], flag: boolean): Generator<Item> { const made = flag ? new Item(false, 7) : list[0]; yield made; yield new Item(false, 8); if (flag) yield made; }
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  for (const one of each(list, flag)) { for (let i = 0; i < times; i++) sum = (sum + (one === item ? item.weight : 1)) | 0; }
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
console.log(drive(items, process.argv.length > 99 ? 1 : 2, 3, process.argv.length < 99));
