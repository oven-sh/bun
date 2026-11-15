import { nextTurns } from "../host.ts";
const counts: Record<string, number> = { alpha: 1, bravo: 2, charlie: 3, delta: 4 };
const keys = ["alpha", "bravo", "charlie", "delta"];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += counts[keys[i & 3]!] = i & 7;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
