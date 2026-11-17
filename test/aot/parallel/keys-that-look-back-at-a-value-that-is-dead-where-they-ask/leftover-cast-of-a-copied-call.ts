class Item {
  mark: any = null;
  weight: number;
  constructor(weight: number) { this.weight = weight; }
}
function markOf(item: Item): any { return item.mark; }
function drive(list: Item[], table: Record<string, number>, at: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  const name = markOf(item) as string;
  if (name) work = 5;
  let sum = work;
  sum = (sum * 3 + at) | 0;
  sum = (sum * 5 + at) | 0;
  sum = (sum * 7 + at) | 0;
  sum = (sum * 9 + at) | 0;
  return table[name] * 1000 + (sum & 0) + work;
}
const items: Item[] = [new Item(2), JSON.parse('{"mark":"right","weight":3}'), new Item(5)];
const table: Record<string, number> = { null: 1, right: 2 };
let last = "";
for (let round = 0; round < 300; round++) last = drive(items, table, 0) + " " + drive(items, table, 1) + " " + drive(items, table, 2);
console.log(last);
