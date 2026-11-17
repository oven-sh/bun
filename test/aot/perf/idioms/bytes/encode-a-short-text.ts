import { nextTurns } from "../host.ts";
let kept: unknown;
const encoder = new TextEncoder();
const pieces: string[] = JSON.parse('["<div class=\\"","row","\\">","Product 17","</div>","<span>","1,299.00","</span>"]');
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const chunk = encoder.encode(pieces[i & 7]!);
    kept = chunk;
    s = (s + chunk.byteLength) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
