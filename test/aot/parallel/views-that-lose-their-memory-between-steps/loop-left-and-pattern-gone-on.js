function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 1;
  let text = "";
  for (let turn = 0; turn < 3; turn++) {
    const inner = turn === 2 ? view : new Uint8Array(1);
    const [a, b = (turn === 2 ? buffer.transfer() : 0, 7), c] = inner;
    text += a + "," + b + "," + c + " ";
  }
  return text;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name); }
}
