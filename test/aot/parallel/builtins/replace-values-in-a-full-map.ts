// A counted loop that only replaces the values of a Map whose table is exactly full does not call the run time for more room.
// The 64 first stores grow the table a few times. The 6,400 that replace a value enter no operation.
// COUNT: operation:operationAOTMapSet <= 10
const map = new Map<number, number>();
for (let i = 0; i < 64; i++) map.set(i * 3, i);
function replaceAll(by: number): number {
  for (let i = 0; i < 64; i++) map.set(i * 3, i + by);
  return map.size;
}
let sizes = 0;
for (let round = 0; round < 100; round++) sizes += replaceAll(round);
console.log(sizes, map.get(63 * 3));
