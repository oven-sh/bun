import { nextTurns } from "../host.ts";
const lists: number[][] = [[1, 2, 3, 2, 1], [4, 4, 4], [5.5, 6.5, 7.5, 8.5], [9]];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += new Set(lists[i & 3]!).size;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
