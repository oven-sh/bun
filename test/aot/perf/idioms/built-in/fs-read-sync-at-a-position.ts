import { openSync, readSync } from "node:fs";
import { nextTurns } from "../host.ts";
function bench(file: number, into: Uint8Array, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += readSync(file, into, 0, 1, 0);
  }
  return s;
}
const file = openSync(process.execPath, "r");
const bytes = new Uint8Array(8);
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(file, bytes, n);
console.log(check);
