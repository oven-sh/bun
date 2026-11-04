function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 4;
  const box = {};
  [box.first, ...box[(buffer.transfer(), "rest")]] = view;
  return box.first + "," + box.rest.length;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(3))); } catch (e) { console.log(e.constructor.name); }
}
