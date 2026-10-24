// Two new objects hold each other, and on one way the ring is kept.
type Link = { next: Link | null; value: number };
const kept: Link[] = [];
function ring(value: number, isKept: boolean): number {
  const first: Link = { next: null, value };
  const second: Link = { next: first, value: value + 1 };
  first.next = second;
  if (isKept) kept.push(first);
  return first.next.next!.value * 10 + second.next!.next!.value;
}
const seen: number[] = [];
for (let turn = 0; turn < 6; turn++) seen.push(ring(turn, turn === 4));
console.log(seen.join(), kept.length, kept[0].next!.next === kept[0], kept[0].next!.value);
