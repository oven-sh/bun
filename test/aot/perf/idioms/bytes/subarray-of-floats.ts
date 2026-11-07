import { nextTurns } from "../host.ts";
let kept: unknown;
const view = new Float64Array(512);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const rest = view.subarray(i & 255);
    kept = rest;
    s = (s + rest.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
