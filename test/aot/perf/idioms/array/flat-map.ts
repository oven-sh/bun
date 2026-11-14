import { nextTurns } from "../host.ts";
const lists: number[][] = [
  [1, 2, 3, 4],
  [8, 7, 6, 5],
  [1, 3, 5, 7],
  [2, 2, 3, 3],
];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += lists[i & 3]!.flatMap(x => [x, x + 1]).length;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
