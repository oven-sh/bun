function take(buffer) {
  const view = new Uint8Array(buffer);
  const box = {};
  [box[(buffer.transfer(), "first")], box.second] = view;
  return box.first + "," + box.second;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(2))); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
}
