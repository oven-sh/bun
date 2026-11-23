class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function* each(list: Item[], flag: boolean): Generator<Item> { const one = list[flag ? 0 : 2]; yield one; one.weight = (one.weight + 1) | 0; yield one; one.weight = (one.weight - 1) | 0; }
function drive(list: Item[], at: number, times: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  const kept: number[] = []; for (const one of each(list, flag)) { if (one === null) { kept.push(-1); continue; } kept.push(one.weight); } for (let i = 0; i < kept.length; i++) sum = (sum + kept[i] * (i + 1)) | 0;
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
console.log(drive(items, process.argv.length > 99 ? 1 : 2, 3, process.argv.length < 99));
