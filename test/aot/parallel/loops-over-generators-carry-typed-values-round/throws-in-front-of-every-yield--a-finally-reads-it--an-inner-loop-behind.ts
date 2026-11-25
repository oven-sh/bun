let tally = 0;
class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
const most = Number(process.argv.length < 99 ? 100 : 0);
function check(n: number): void { if (n > most) throw new RangeError("over"); }
function* pick(flag: boolean, n: number): Generator<number> { check(n + 40); if (flag) yield 1; yield 2; }
function drive(list: Item[], at: number, times: number, flag: boolean, n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  if (item.skip) return -1;
  const first = item.weight;
  if (first > 90) return -2;
  let sum = work;
  try { try { for (const x of pick(flag, n)) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x) | 0; } } finally { sum = (sum + item.weight * 10) | 0; } } catch { sum = -sum; }
  for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0;
  return sum;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) for (const n of [50, 75, 95, 125]) last += drive(items, at, 3, flag, n) + " ";
}
console.log(last + tally);
