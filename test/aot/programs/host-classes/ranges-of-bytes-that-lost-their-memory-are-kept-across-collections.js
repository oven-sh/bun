// The buffer of a view is transferred between view.subarray(n) and the use of the range, three thousand times, with collections in between: the ranges that are kept stay what they were.
// IR+ = TypedArrayRange
const impostor = { got: null, encodeInto(text, destination) { this.got = destination; return { read: -1, written: destination.length }; } };
const real = new TextEncoder();
let page = new Uint8Array(8), at = 0;
const hidden = JSON.parse("[0]")[0];
const holders = [{ get encoder() { page.buffer.transfer(); return impostor; } }, { get encoder() { page.buffer.transfer(); return real; } }, { encoder: impostor }];
function writeHeld(which, text) {
  let target = page;
  if (0 < at) target = page.subarray(at);
  const counts = holders[which + hidden].encoder.encodeInto(text, target);
  return counts.read + "/" + counts.written;
}
const kept = []; let sum = "";
for (let i = 0; i < 3000; i++) {
  page = new Uint8Array(i % 3 ? 8 : 5000); at = 1 + (i & 3);
  const bytes = page, answer = writeHeld(i % 3, "ab");
  if (i % 3 !== 1) { const got = impostor.got; if (got.buffer !== bytes.buffer) sum += "!"; if (i % 7 === 0) kept.push(got); if (i % 500 === 0) sum += answer + ":" + got.length + "@" + got.byteOffset + ":" + got.buffer.byteLength + ":" + got.buffer.detached + " "; }
  if (i % 400 === 399) Bun.gc(true);
}
Bun.gc(true);
console.log(sum, kept.length, kept.reduce((n, view) => n + view.length + view.byteOffset + view.buffer.byteLength, 0), kept.filter(view => view.buffer.detached).length);
