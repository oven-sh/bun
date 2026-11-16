function take(buffer) {
  const view = new Uint8Array(buffer);
  const [a, b = (buffer.transfer(), 7), c] = view;
  return a + "," + b + "," + c;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name); }
}
