import { nextTurns } from "../host.ts";
const queue: Uint8Array[] = [new Uint8Array(4), Buffer.from("</a>!"), new Uint8Array(9), Buffer.alloc(22)];
function bench(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + queue[i & 3].byteLength) & 0xffff;
  return sum;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
