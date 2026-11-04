function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 3;
  const [a, b = (buffer.transfer(), 7), c] = view;
  return a + b + (c === undefined ? 100 : 0);
}
let sum = 0;
let thrown = 0;
for (let i = 0; i < 300; i++) {
  try { sum += take(new ArrayBuffer(1)); } catch (e) { thrown++; }
}
console.log(sum + " " + thrown);
