function main() {
  let big = { tag: 1, bytes: new Uint8Array(50_000_000) };
  class Reader { get tag() { return big === null ? -1 : big.tag; } drop() { big = null; } }
  const reader = new Reader();
  const ref = new WeakRef(big);
  big.bytes[0] = reader.tag;
  return { ref, reader };
}
const { ref, reader } = main();
console.log(reader.tag);
reader.drop();
let turns = 0;
const ask = () => {
  Bun.gc(true);
  if (++turns < 5) { setTimeout(ask, 1); return; }
  console.log(reader.tag, ref.deref() === undefined, process.memoryUsage().arrayBuffers < 10_000_000);
};
setTimeout(ask, 1);
