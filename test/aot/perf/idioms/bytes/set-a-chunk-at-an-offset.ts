import { nextTurns } from "../host.ts";
let kept: unknown;
const chunks: Uint8Array[] = ["<div class=\"", "row", "\">", "Product 17", "</div>", "<span>", "1,299.00", "</span>"].map(text => new TextEncoder().encode(text));
const view = new Uint8Array(4096);
function bench(n: number): number {
  let written = 0;
  for (let i = 0; i < n; i++) {
    const chunk = chunks[i & 7]!;
    view.set(chunk, written);
    written += chunk.byteLength;
    if (written > 4000) written = 0;
  }
  kept = view;
  return written;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
