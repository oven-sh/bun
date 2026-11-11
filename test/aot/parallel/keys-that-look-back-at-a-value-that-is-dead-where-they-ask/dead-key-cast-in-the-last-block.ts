class Item {
  skip: boolean;
  weight: number;
  mark: any = null;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function drive(list: Item[], table: Record<string, number>, at: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  const mark = item.mark;
  if (item.skip) return -1;
  const weight = item.weight;
  if (at > 90) return -2;
  const name = mark as string;
  let sum = work;
  sum = (sum * 3 + at) | 0;
  sum = (sum * 5 + at) | 0;
  sum = (sum * 7 + at) | 0;
  sum = (sum * 9 + at) | 0;
  return table[name] * 1000 + (sum & 0) + weight;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3,"mark":"right"}'), new Item(false, 5)];
const table: Record<string, number> = { null: 1, right: 2 };
let last = "";
for (let round = 0; round < 300; round++) last = drive(items, table, 0) + " " + drive(items, table, 1) + " " + drive(items, table, 2);
console.log(last);
