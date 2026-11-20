function make() { return { buffer: Buffer.alloc(64) }; }
function view(it) { return new DataView(it.buffer.buffer, it.buffer.byteOffset, it.buffer.byteLength); }
let errors = 0, first = -1, said = "";
for (let round = 0; round < 20000; round++) {
  const it = make();
  it.buffer[0] = round;
  try { view(it).setUint8(1, 2); } catch (error) { if (errors++ === 0) { first = round; said = String(error) + " " + it.buffer.byteLength; } }
}
console.log("errors", errors, "first at round", first, said);
