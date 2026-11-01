import { nextTurns } from "../host.ts";
const queue: ArrayBuffer[] = [new ArrayBuffer(4), new ArrayBuffer(5), new ArrayBuffer(9), new ArrayBuffer(22)];
function bench(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + queue[i & 3].byteLength) & 0xffff;
  return sum;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
