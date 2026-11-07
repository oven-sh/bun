function main() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let big = { tag: 1, bytes: new Uint8Array(50_000_000) };
  const tagOfBig = () => big.tag;
  const ref = new WeakRef(big);
  work += tagOfBig();
  big.bytes[0] = work;
  return ref;
}
const ref = main();
let turns = 0;
const ask = () => {
  Bun.gc(true);
  if (++turns < 5) { setTimeout(ask, 1); return; }
  console.log(ref.deref() === undefined, process.memoryUsage().arrayBuffers < 10_000_000);
};
setTimeout(ask, 1);
