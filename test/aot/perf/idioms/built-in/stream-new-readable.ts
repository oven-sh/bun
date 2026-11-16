import { Readable, Transform } from "node:stream";
import { nextTurns } from "../host.ts";
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += new Readable({ read() {} }).readableLength + new Transform().writableLength;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
