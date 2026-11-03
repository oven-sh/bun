import { nextTurns } from "../host.ts";
let kept: unknown;
const view = new Uint8Array(4096);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const written = view.subarray(0, i & 4095);
    kept = written;
    s = (s + written.byteLength) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
