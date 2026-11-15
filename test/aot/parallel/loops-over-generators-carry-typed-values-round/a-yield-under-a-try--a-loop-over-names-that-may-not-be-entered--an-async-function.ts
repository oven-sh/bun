let tally = 0;
class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
const set = new Set<number>([1, 2, 3]);
const map = new Map<number, number>([[1, 10], [2, 20]]);
const label: string = "abc";
function pickList(list: Item[], x: number): Item[] { if (x === 2) throw new RangeError("two"); return list; }
function* pick(flag: boolean): Generator<number> { try { if (flag) yield 1; yield 2; } finally { tally++; } }
async function drive(list: Item[], at: number, flag: boolean): Promise<number> {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  for (const x of pick(flag)) {
    if (x === 1) await null;
    if (x === 1) continue; for (const name in item) sum = (sum + name.length) | 0;
  }
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += (await drive(items, at, flag)) + " ";
}
console.log(last + tally);
