// TextEncoder.encodeInto is handed a subarray of a Uint16Array.
// Flags: --aot-validate
const encoder = new TextEncoder();
function write4(view: any, text: any): string {
  const target = view.subarray();
  const counts = encoder.encodeInto(text, target);
  return JSON.stringify(counts);
}
let view: any = new Uint16Array();
for (let step = 0; step < 20; step++) {
  try { console.log(write4(view, "x".repeat(64))); } catch (error) { console.log((error as Error).name); }
}
