class Item {
  skip: boolean;
  parts: number[];
  constructor(skip: boolean, parts: number[]) { this.skip = skip; this.parts = parts; }
}
function* pick(flag: boolean): Generator<number> { if (flag) yield 1; yield 2; yield 3; }
function drive(list: Item[], at: number, flag: boolean) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  if (item.skip) return -1;
  let sum = work;
  for (const x of pick(flag)) { for (const part of item.parts) sum = (sum + part * x) | 0; for (const key in { one: 1, three: 3 }) sum = (sum + key.length) | 0; }
  return sum;
}
const items: Item[] = [new Item(false, [2, 4]), JSON.parse('{"skip":false,"parts":[3]}'), new Item(false, [5, 1, 1])];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += (await drive(items, at, flag)) + " ";
}
console.log(last);
