import { nextTurns } from "../host.ts";
let kept: unknown;
const chunks = [new Float32Array([1, 2, 3]), new Float32Array([4, 5]), new Float32Array([6]), new Float32Array([7, 8, 9, 10])];
const view = new Float32Array(1024);
function bench(n: number): number {
  let written = 0;
  for (let i = 0; i < n; i++) {
    const chunk = chunks[i & 3]!;
    view.set(chunk, written);
    written += chunk.length;
    if (written > 1000) written = 0;
  }
  kept = view;
  return written;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
