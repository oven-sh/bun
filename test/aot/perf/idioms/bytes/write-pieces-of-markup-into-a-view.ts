import { nextTurns } from "../host.ts";
let kept: unknown;
const encoder = new TextEncoder();
let view: Uint8Array = new Uint8Array(4096);
let written = 0;
let sent = 0;
function flush(chunk: Uint8Array): void {
  kept = chunk;
  sent = (sent + chunk.byteLength) | 0;
}
function writeChunk(text: string): void {
  if (text.length === 0) return;
  let target = view;
  if (0 < written) target = view.subarray(written);
  const counts = encoder.encodeInto(text, target);
  const read = counts.read;
  written += counts.written;
  if (read < text.length) {
    flush(view.subarray(0, written));
    view = new Uint8Array(4096);
    written = encoder.encodeInto(text.slice(read), view).written;
  }
  if (written === 4096) {
    flush(view);
    view = new Uint8Array(4096);
    written = 0;
  }
}
const pieces: string[] = JSON.parse('["<td class=","price",">","146.19","</td>","<span>","in stock","</span>"]');
function bench(n: number): number {
  for (let i = 0; i < n; i++) writeChunk(pieces[i & 7]!);
  return sent + written;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
