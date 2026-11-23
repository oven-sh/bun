import { nextTurns } from "../host.ts";
function bench(n: number): number {
  const records = [{ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3, d: 4 }];
  let s = 0;
  for (let i = 0; i < n; i++) s += Object.values(records[i & 3]!).length;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
