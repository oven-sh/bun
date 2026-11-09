import { nextTurns } from "../host.ts";
let kept: unknown;
const buffers: Buffer[] = ["<div class=\"", "row", "\">", "Product 17", "</div>", "<span>", "1,299.00", "</span>"].map(text => Buffer.from(text));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = buffers[i & 7]!.toString();
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
