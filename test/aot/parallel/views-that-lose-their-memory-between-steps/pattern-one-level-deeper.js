function take(buffer) {
  const view = new Uint8Array(buffer);
  const [[a, b = (buffer.transfer(), 7), c], tail] = [view, "tail"];
  return a + "," + b + "," + c + "," + tail;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name); }
}
