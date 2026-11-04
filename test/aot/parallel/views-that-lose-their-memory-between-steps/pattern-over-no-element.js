function take(buffer) {
  const view = new Uint8Array(buffer);
  const [a = (buffer.transfer(), 5), b, c = 9] = view;
  return a + "," + b + "," + c;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(0))); } catch (e) { console.log(e.constructor.name); }
}
