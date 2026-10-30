import { nextTurns } from "../host.ts";
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += process.argv.length > (i & 1) ? 1 : 0;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
