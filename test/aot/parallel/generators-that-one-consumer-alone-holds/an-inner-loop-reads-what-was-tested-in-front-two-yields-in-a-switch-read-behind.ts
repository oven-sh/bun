class Item {
  skip: boolean;
  weight: number;
  constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; }
}
function* pick(kind: number): Generator<number> {
  switch (kind) {
    case 0: yield 1; break;
    case 1: yield 2; break;
    default: return;
  }
}
function drive(list: Item[], at: number, times: number, kind: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const item = list[at];
  if (item.skip) return -1;
  const first = item.weight;
  if (first > 90) return -2;
  let sum = work;
  for (const x of pick(kind)) {
    for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0;
    sum = (sum + x) | 0;
  }
  return (sum + item.weight) | 0;
}
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  for (const kind of [0, 1, 2]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, kind) + " ";
}
console.log(last);
