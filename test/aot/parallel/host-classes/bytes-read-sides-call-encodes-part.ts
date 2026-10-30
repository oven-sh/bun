// An element is read on both sides of the call that writes it, in one function.
// Flags: --aot-validate
const encoder = new TextEncoder();
function around(view: Uint8Array, text: string, at: number): string {
  const before = view[at];
  const written = encoder.encodeInto(text, view.subarray(at)).written;
  return before + "/" + written + "/" + view[at];
}
function aroundKept(view: Uint8Array, text: string, at: number): string {
  const before = view[at];
  const counts = encoder.encodeInto(text, view.subarray(at));
  return before + "/" + JSON.stringify(counts) + "/" + view[at];
}
function inLoop(view: Uint8Array, texts: string[]): number {
  let sum = 0;
  for (let i = 0; i < texts.length; i++) {
    sum += view[2];
    encoder.encodeInto(texts[i], view.subarray(2));
    sum = sum * 3 + view[2];
  }
  return sum;
}
const view = new Uint8Array(8);
for (const text of ["a", "b", "", "xyz"]) console.log(around(view, text, 1), aroundKept(view, text + "q", 3));
console.log(inLoop(view, ["a", "b", "c", "", "d"]), Array.from(view).join());
let total = 0;
for (let turn = 0; turn < 30000; turn++) total = (total + around(view, String.fromCharCode(65 + (turn % 26)), turn & 3).length + inLoop(view, ["k", "l"])) | 0;
console.log(total, Array.from(view).join());
