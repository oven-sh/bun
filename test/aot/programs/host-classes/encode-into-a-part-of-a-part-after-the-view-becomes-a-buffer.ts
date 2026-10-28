// The first cut is Buffer's own subarray when the view is a Buffer, so the second cut and the call see a view of one of two classes.
const encoder = new TextEncoder();
const texts: string[] = JSON.parse('["<div>","row","é","Product 17"]');
function writeIntoPart(view: Uint8Array, text: string): string {
  const target = view.subarray(view.length - 8, -2).subarray(1);
  return "/" + encoder.encodeInto(text, target).written;
}
function keepCounts(view: Uint8Array, text: string): string {
  return JSON.stringify({ ...encoder.encodeInto(text, view) });
}
{
  let view: any = new Uint8Array(new ArrayBuffer(64, { maxByteLength: 136 }));
  for (let step = 0; step < 6; step++) {
    let answer;
    try { answer = writeIntoPart(view, texts[step & 3]); } catch (error: any) { answer = "throws " + error.name; }
    console.log(step, answer, view.constructor.name, Array.from(view.subarray(-8)).join());
    if (step === 2) view = Buffer.alloc(64);
  }
}
{
  let view: any = new Uint8ClampedArray(2);
  for (let step = 0; step < 3; step++) {
    let answer;
    try { answer = keepCounts(view, "ab日"); } catch (error: any) { answer = "throws " + error.name; }
    console.log(step, answer);
  }
}
