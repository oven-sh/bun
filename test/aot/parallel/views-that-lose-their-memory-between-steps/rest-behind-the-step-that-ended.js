function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 4;
  const [a, b = (buffer.transfer(), 7), ...rest] = view;
  return a + "," + b + "," + rest.length;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name); }
}
