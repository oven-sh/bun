// Flags: --aot-testing=CheckProofsAtRunTime,CheckWalkAtRunTime --aot-check=Validate
// The heads of the loops over the set and the map have a parameter that the compiler lays for itself, the table that is gone through by index: no value of the language, and nothing asks it.
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
function* pick(flag: boolean): Generator<number> { for (let i = 0; i < 2; i++) yield i; if (flag) yield 9; }
function drive(list: Item[], at: number, flag: boolean): number {
  const item = list[at];
  if (item.skip) return -1;
  let sum = item.weight;
  for (const x of pick(flag)) {
    
    for (const each of set) sum = (sum + each) | 0; for (const [key, value] of map) sum = (sum + key + value + x) | 0;
  }
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, flag) + " ";
}
console.log(last + tally);
