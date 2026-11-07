const unseen = (x: any): any => [x][JSON.parse("0")];
class Item {
  flags: number = 0;
  kind: number = 0;
  constructor(flags: number, kind: number) { this.flags = flags; this.kind = kind; }
}
function firstBad(items: Item[], j: number, limit: number, rounds: number): number {
  let work = 0;
  for (let w = 0; w < rounds; w++) work = (work + w) | 0;
  const node = items[j];
  let seen = 0;
  let i = 0;
  for (; i < 2; i++) {
    if (node.kind === undefined) break;
    seen = seen + node.kind;
    if (seen === limit) seen = 0;
  }
  if (i < 2) return -1 - i;
  return seen + work;
}
const two: number = unseen(2);
const good: Item[] = [new Item(1, 5), new Item(2, 7)];
const odd: Item[] = [JSON.parse('{"flags":3}')];
let sum = 0;
for (let r = 0; r < 300; r++) sum += firstBad(good, r & 1, 1000, two);
console.log(sum);
console.log(firstBad(odd, 0, 1000, two));
