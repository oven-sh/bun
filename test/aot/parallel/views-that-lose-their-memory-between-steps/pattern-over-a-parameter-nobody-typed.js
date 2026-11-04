function take(view, buffer) {
  const [a, b = (buffer.transfer(), 7), c] = view;
  return a + "," + b + "," + c;
}
for (let i = 0; i < 3; i++) {
  const buffer = new ArrayBuffer(1);
  const view = new Uint8Array(buffer);
  view[0] = 40 + i;
  try { console.log(take(view, buffer)); } catch (e) { console.log(e.constructor.name); }
}
