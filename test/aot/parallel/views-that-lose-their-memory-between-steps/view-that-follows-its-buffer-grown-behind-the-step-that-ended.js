function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 2;
  const [a, b = (buffer.resize(4), view.fill(9), 7), c, d] = view;
  return a + "," + b + "," + c + "," + d + "," + view.length;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1, { maxByteLength: 8 }))); } catch (e) { console.log(e.constructor.name); }
}
