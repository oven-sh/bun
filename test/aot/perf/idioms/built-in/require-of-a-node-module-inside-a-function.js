import { nextTurns } from "../host.ts";
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (require("node:events") !== undefined) s++;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
