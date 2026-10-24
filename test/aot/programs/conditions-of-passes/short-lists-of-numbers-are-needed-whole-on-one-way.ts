// Short lists of numbers, some of them NaN, are read and stored into at a place that is known only at run time, on one way only.
const numbers: number[] = [1.5, NaN, 2.5, 3, -0, 4.25, NaN, 7];
function seldomStores(first: number, second: number, at: number, isStored: boolean): string {
  const pair = [first, second];
  if (isStored) pair[at] = 9.5;
  return pair[0] + ":" + pair[1];
}
function seldomReads(first: number, second: number, at: number, isRead: boolean): number {
  const pair = [first, second];
  if (isRead) return pair[at];
  return pair[0] + pair[1];
}
function seldomReadsInALoop(first: number, second: number, upTo: number, isRead: boolean): number {
  const pair = [first, second];
  let sum = pair[0];
  if (isRead) for (let at = 0; at < upTo; at++) sum += pair[at] * 2;
  return sum;
}
const seen: unknown[] = [];
for (let round = 0; round < 3; round++)
  for (let turn = 0; turn < numbers.length; turn++) {
    const first = numbers[turn],
      second = numbers[(turn + 1) % 8];
    seen.push(seldomStores(first, second, turn & 1, turn % 3 === round));
    seen.push(seldomReads(first, second, turn & 1, turn % 3 === round));
    seen.push(seldomReadsInALoop(first, second, 1 + (turn & 1), turn % 3 === round));
  }
console.log(seen.join());
