let held: ArrayBuffer = new ArrayBuffer(0);
function take([a, b = (held.transfer(), 7), c]: Uint8Array): string {
  return a + "," + b + "," + c;
}
for (let i = 0; i < 3; i++) {
  held = new ArrayBuffer(1);
  try { console.log(take(new Uint8Array(held))); } catch (e) { console.log((e as Error).constructor.name); }
}
