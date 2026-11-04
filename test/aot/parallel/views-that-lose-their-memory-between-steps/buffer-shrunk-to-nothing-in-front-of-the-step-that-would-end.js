function take(buffer) {
  const view = new Uint8Array(buffer, 0, 1);
  view[0] = 2;
  const box = {};
  try {
    [box.first, box[(buffer.resize(0), "second")]] = view;
  } catch (e) {
    return e.constructor.name + ": " + e.message + " | " + box.first;
  }
  return box.first + "," + box.second;
}
for (let i = 0; i < 3; i++)
  console.log(take(new ArrayBuffer(1, { maxByteLength: 8 })));
