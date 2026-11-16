import { nextTurns } from "../host.ts";
let kept: unknown;
const view = new Uint8Array(4096);
const parts = [view.subarray(0, 4096), view.subarray(16, 900), view.subarray(1024, 1100), view.subarray(4000)];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const chunk = parts[i & 3]!;
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    kept = buffer;
    s = (s + buffer.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
