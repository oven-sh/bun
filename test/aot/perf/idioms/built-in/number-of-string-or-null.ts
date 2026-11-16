import { nextTurns } from "../host.ts";
function bench(values: (string | null)[], n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) s += Number(values[i & 3]);
  return s;
}
const subject = ["2", "10", "150", "7"];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
