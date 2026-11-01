function marks(start) {
  const seen = new Uint8Array(64);
  let marked = 0;
  for (let at = start; at < 200; at += 3) {
    if (seen[at & 127]) continue;
    seen[at & 127] = 1;
    marked++;
  }
  return marked;
}
let marked = 0;
for (let i = 0; i < 100; i++) marked += marks(i);
console.log(marked);

function outside() {
  const view = new Int16Array(4);
  const seen = [];
  for (const at of [-1, 0, 3, 4, 1.5, -0, NaN, 4294967296]) {
    view[at] = 7;
    seen.push(String(view[at]));
  }
  return seen.join() + " " + view.join();
}
console.log(outside());

function bufferIsTakenAway() {
  const view = new Uint8Array(8);
  view[1] = 7;
  const before = view[1];
  const moved = view.buffer.transfer();
  view[2] = 5;
  return [before, String(view[1]), String(view[2]), view.length, moved.byteLength, new Uint8Array(moved)[1]].join();
}
console.log(bufferIsTakenAway());

function bufferIsHandedToAClone() {
  const view = new Float64Array(2);
  view[0] = 1.5;
  const copy = structuredClone(view, { transfer: [view.buffer] });
  view[0] = 2.5;
  return [String(view[0]), view.length, copy[0], copy.length].join();
}
console.log(bufferIsHandedToAClone());

function twoViewsOfOneBuffer() {
  const words = new Int32Array(4);
  const bytes = new Uint8Array(words.buffer);
  bytes[4] = 1;
  bytes[5] = 1;
  words[3] = -1;
  return words[1] + " " + bytes[15] + " " + String(words[4]) + " " + String(bytes[16]);
}
console.log(twoViewsOfOneBuffer());

function ofNoLength() {
  const view = new Uint32Array(0);
  view[0] = 1;
  return String(view[0]) + view.length;
}
console.log(ofNoLength());

function large() {
  const view = new Uint8Array(200000);
  view[199999] = 9;
  view[200000] = 9;
  return view[199999] + " " + String(view[200000]);
}
console.log(large());

function overABufferThatGrows() {
  const buffer = new ArrayBuffer(4, { maxByteLength: 16 });
  const view = new Uint8Array(buffer);
  const before = String(view[6]);
  buffer.resize(8);
  view[6] = 3;
  return before + " " + view[6] + " " + view.length;
}
console.log(overABufferThatGrows());
