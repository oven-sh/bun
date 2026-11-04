function take(buffer, early) {
  const view = new Uint8Array(buffer, 2);
  view[0] = 5;
  const box = {};
  try {
    if (early)
      [box.first, box[(buffer.resize(1), "second")], box.third] = view;
    else
      [box.first, box.second, box[(buffer.resize(1), "third")], box.fourth] = view;
  } catch (e) {
    return e.constructor.name + " | " + box.first + "," + box.second;
  }
  return box.first + "," + box.second + "," + box.third + "," + box.fourth;
}
for (let i = 0; i < 3; i++) {
  console.log(take(new ArrayBuffer(3, { maxByteLength: 8 }), true));
  console.log(take(new ArrayBuffer(3, { maxByteLength: 8 }), false));
}
