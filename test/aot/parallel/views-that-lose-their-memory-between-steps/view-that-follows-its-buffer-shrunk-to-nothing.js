function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 2;
  view[1] = 3;
  const box = {};
  [box.first, box[(buffer.resize(0), "second")], box.third] = view;
  return box.first + "," + box.second + "," + box.third + "," + view.length;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(2, { maxByteLength: 8 }))); } catch (e) { console.log(e.constructor.name); }
}
