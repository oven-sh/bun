import { nextTurns } from "../host.ts";
const buffer: Buffer = Buffer.alloc(128, 7);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += buffer.readUInt8(i & 63) + (buffer.readUInt16LE(i & 63) & 15) + (buffer.readUInt32BE(i & 63) & 15) + (buffer.readInt32LE(i & 63) & 15);
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
