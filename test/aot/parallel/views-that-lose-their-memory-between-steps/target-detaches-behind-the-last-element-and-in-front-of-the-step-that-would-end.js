function take(buffer) {
  const view = new Uint8Array(buffer);
  const box = {};
  try {
    [box.first, box[(buffer.transfer(), "second")], box.third] = view;
  } catch (e) {
    return e.constructor.name + ": " + e.message + " | " + box.first + "," + box.second + "," + box.third;
  }
  return box.first + "," + box.second + "," + box.third;
}
for (let i = 0; i < 3; i++)
  console.log(take(new ArrayBuffer(1)));
