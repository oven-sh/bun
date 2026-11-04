function take(buffer) {
  const view = new Float32Array(buffer);
  const [a, b = (buffer.transfer(), 7), c] = view;
  return typeof a + " " + a + "," + b + "," + c;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT))); } catch (e) { console.log(e.constructor.name); }
}
