import { nextTurns } from "../host.ts";
const lists: number[][] = [
  [1, 2, 3, 4, 5, 6, 7, 8],
  [8, 7, 6, 5, 4, 3, 2, 1],
  [1, 3, 5, 7, 2, 4, 6, 8],
  [2, 2, 2, 2, 3, 3, 3, 3],
];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++)
    s += lists[i & 3]!
      .map(x => x * 2 + i)
      .filter(x => (x & 1) === (i & 1))
      .reduce((sum, x) => sum + x, 0) & 7;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
