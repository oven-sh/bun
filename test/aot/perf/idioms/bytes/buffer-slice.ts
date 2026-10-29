import { nextTurns } from "../host.ts";
let kept: unknown;
const buffer = Buffer.alloc(4096);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const part = buffer.slice(i & 1023, 2048);
    kept = part;
    s = (s + part.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
