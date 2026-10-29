// The variable may hold a Buffer, so the first cut may be Buffer's own subarray, and the second cut has a receiver of one of two classes.
const encoder = new TextEncoder();
function write(view: Uint8Array): number {
  return encoder.encodeInto("row", view.subarray(0, view.length).subarray(1)).written;
}
function keepCounts(view: Uint8Array): string {
  return JSON.stringify({ ...encoder.encodeInto("ab", view) });
}
let view: Uint8Array = new Uint8Array(8);
for (let step = 0; step < 4; step++) {
  console.log(write(view), view.constructor.name, Array.from(view).join());
  if (step === 1) view = Buffer.alloc(3);
}
console.log(keepCounts(new Uint8Array(2)));
