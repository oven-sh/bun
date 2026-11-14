import { nextTurns } from "../host.ts";
let kept: unknown;
const page = new Uint8Array(4096).fill(97);
const whole = new Uint8Array(16384);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    whole.set(page, (i & 3) << 12);
    s = (s + page.byteLength) | 0;
  }
  kept = whole;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
