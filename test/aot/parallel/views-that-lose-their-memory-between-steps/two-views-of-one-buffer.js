function take(buffer) {
  const bytes = new Uint8Array(buffer);
  const words = new Uint16Array(buffer);
  bytes[0] = 1;
  const [a, b, c = (buffer.transfer(), 7), d] = bytes;
  let second;
  try {
    const [e, f = 8] = words;
    second = e + "," + f;
  } catch (e) {
    second = e.constructor.name;
  }
  return a + "," + b + "," + c + "," + d + " | " + second;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(2))); } catch (e) { console.log(e.constructor.name); }
}
