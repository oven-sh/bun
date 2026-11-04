function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 2;
  const box = {};
  [box.first, box[(buffer.resize(3), view.fill(9), "second")], box.third, box.fourth] = view;
  return box.first + "," + box.second + "," + box.third + "," + box.fourth;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1, { maxByteLength: 8 }))); } catch (e) { console.log(e.constructor.name); }
}
