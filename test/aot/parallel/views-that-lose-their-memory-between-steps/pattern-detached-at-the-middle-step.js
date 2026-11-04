function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 1;
  view[1] = 2;
  const [a, b, c = (buffer.transfer(), 7), d, e = 8] = view;
  return a + "," + b + "," + c + "," + d + "," + e;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(2))); } catch (e) { console.log(e.constructor.name); }
}
