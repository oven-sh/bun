function make() { return { buffer: Buffer.alloc(64) }; }
function use(it) { return it.buffer.buffer.byteLength + it.buffer.byteOffset + it.buffer.byteLength; }
const seen = new Map(); let kept = 0;
for (let round = 0; round < 20000; round++) {
  const it = make();
  it.buffer[0] = round;
  let got;
  try { got = String(use(it)); } catch (error) { got = String(error); kept += it.buffer.byteLength; }
  seen.set(got, (seen.get(got) ?? 0) + 1);
}
console.log(JSON.stringify([...seen]));
