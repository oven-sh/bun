function take(buffer) {
  const view = new Uint8Array(buffer, 0, 1);
  view[0] = 2;
  const [a, b = (buffer.resize(0), 7), c] = view;
  return a + "," + b + "," + c + "," + view.length;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1, { maxByteLength: 8 }))); } catch (e) { console.log(e.constructor.name); }
}
