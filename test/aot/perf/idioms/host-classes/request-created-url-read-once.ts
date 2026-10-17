import { nextTurns } from "../host.ts";
function bench(address: string, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += new Request(address).url.length;
  }
  return s;
}
const subject = "http://example.com/a/b?c=d";
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(subject, n);
console.log(check);
