// Each piece goes behind the last one. The part of the view that is still free ends where the view ends.
// Flags: --aot-validate
const encoder = new TextEncoder();
function writeAll(view: Uint8Array, pieces: string[]): number {
  let written = 0;
  for (const piece of pieces) written += encoder.encodeInto(piece, view.subarray(written)).written;
  return written;
}
const view = new Uint8Array(24);
console.log(writeAll(view, ["<li>", "é", "日本", "</li>", "does not fit any more"]), Array.from(view).join());
