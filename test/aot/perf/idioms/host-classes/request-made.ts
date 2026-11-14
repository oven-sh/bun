import { nextTurns } from "../host.ts";
function bench(address: string, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (new Request(address) !== undefined) s++;
  }
  return s;
}
const subject = "http://example.com/a/b?c=d";
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
