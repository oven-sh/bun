// The length of a buffer is read twice. Between the two reads the collector runs and many buffers of other lengths are made, and nothing names the buffer behind the second read.
const kept = [];
function readTwice(i) {
  const buffer = new ArrayBuffer(64 + (i & 7));
  const first = buffer.byteLength;
  Bun.gc(true);
  for (let k = 0; k < 400; k++) kept.push(new ArrayBuffer(100000 + k));
  if (kept.length > 4000) kept.length = 0;
  const second = buffer.byteLength;
  return first === second ? 0 : 1;
}
let differing = 0;
for (let i = 0; i < 40; i++) differing += readTwice(i);
console.log(differing, "of 40 lengths differ");
