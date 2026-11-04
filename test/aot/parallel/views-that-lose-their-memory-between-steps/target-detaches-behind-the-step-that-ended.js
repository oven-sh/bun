function take(buffer) {
  const view = new Uint8Array(buffer);
  view[0] = 6;
  const box = {};
  try {
    [box.first, box.second, box[(buffer.transfer(), "third")], box.fourth] = view;
  } catch (e) {
    return e.constructor.name + " | " + box.first + "," + box.second + "," + box.third;
  }
  return box.first + "," + box.second + "," + box.third + "," + box.fourth + "," + ("third" in box);
}
for (let i = 0; i < 3; i++)
  console.log(take(new ArrayBuffer(1)));
