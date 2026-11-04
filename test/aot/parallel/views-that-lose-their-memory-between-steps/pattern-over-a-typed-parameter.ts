function take(view: Uint8Array, buffer: ArrayBuffer): string {
  const [a, b = (buffer.transfer(), 7), c, d] = view;
  return a + "," + b + "," + c + "," + d;
}
for (let i = 0; i < 3; i++) {
  const buffer = new ArrayBuffer(1);
  const view = new Uint8Array(buffer);
  view[0] = 40 + i;
  try { console.log(take(view, buffer)); } catch (e) { console.log((e as Error).constructor.name); }
}
