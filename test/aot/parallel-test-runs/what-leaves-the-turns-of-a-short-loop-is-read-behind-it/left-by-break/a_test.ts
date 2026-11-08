// `for (; i < 2; i++) { if (node.kind === undefined) break; .. } if (i < 2) return -1 - i;` in a test file: the turns are written out, and the block behind the loop is walked once for the ways of closed arms and once for the others.
import { test } from "bun:test";
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
function eachTurnItsOwn(items: Item[], j: number, limit: number, rounds: number): number {
  let work = 0;
  for (let w = 0; w < rounds; w++) work = (work + w) | 0;
  let seen = 0;
  let i = 0;
  let k = 10;
  for (; i < 3; i++, k = k + 3) {
    const node = items[(j + i) % items.length];
    if (node.kind === undefined) break;
    seen = seen + node.kind;
    if (seen === limit) seen = 0;
  }
  if (i < 3) return -1 - i - k - seen;
  return seen + work + k;
}
const two: number = unseen(2);
const good: Item[] = [new Item(1, 5), new Item(2, 7)];
const odd: Item[] = [JSON.parse('{"flags":3}')];
const mixed: Item[] = [new Item(1, 5), JSON.parse('{"flags":3}')];
test("the counter is read behind the loop", () => {
  let sum = 0;
  for (let r = 0; r < 300; r++) sum += firstBad(good, r & 1, 1000, two);
  console.log(sum, firstBad(odd, 0, 1000, two), firstBad(mixed, 0, 1000, two), firstBad(mixed, 1, 1000, two));
});
test("three values are read behind the loop", () => {
  let sum = 0;
  for (let r = 0; r < 300; r++) sum += eachTurnItsOwn(good, r & 1, 1000, two);
  console.log(sum, eachTurnItsOwn(odd, 0, 1000, two), eachTurnItsOwn(mixed, 0, 1000, two), eachTurnItsOwn(mixed, 1, 1000, two));
});
