import { nextTurns } from "../host.ts";
const buffer: Buffer = Buffer.alloc(128, 7);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += buffer.writeUInt8(i & 255, i & 63) + buffer.writeUInt16BE(i & 65535, i & 63) + buffer.writeUInt32LE(i, i & 63);
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
