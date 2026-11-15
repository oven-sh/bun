import { nextTurns } from "../host.ts";
let kept: unknown;
const encoder = new TextEncoder();
const pieces: string[] = JSON.parse('["<div class=\\"","row","\\">","Product 17","</div>","<span>","1,299.00","</span>"]');
const view = new Uint8Array(4096);
let written = 0;
function write(text: string): void {
  let target = view;
  if (written > 0) target = view.subarray(written);
  const result = encoder.encodeInto(text, target);
  written += result.written;
  if (result.read < text.length || written > 4000) written = 0;
}
function bench(n: number): number {
  for (let i = 0; i < n; i++) write(pieces[i & 7]!);
  kept = view;
  return written;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
