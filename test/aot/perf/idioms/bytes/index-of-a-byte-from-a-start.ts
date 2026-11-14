import { nextTurns } from "../host.ts";
let kept: unknown;
const rowsOfBytes = new TextEncoder().encode("1:{\"id\":17,\"title\":\"Product 17\"}\n".repeat(100));
function bench(n: number): number {
  let s = 0, at = 0;
  for (let i = 0; i < n; i++) {
    at = rowsOfBytes.indexOf(10, at) + 1;
    if (at === 0 || at >= rowsOfBytes.length) at = 0;
    s = (s + at) | 0;
  }
  kept = rowsOfBytes;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
