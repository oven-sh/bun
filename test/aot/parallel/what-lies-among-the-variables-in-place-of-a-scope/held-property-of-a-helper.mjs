function makeLookup(size) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const lookup = (n) => (n + 1) | 0;
  lookup.table = { tag: work, bytes: new Uint8Array(size) };
  return lookup;
}
function main() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const lookup = makeLookup(50_000_000);
  const other = makeLookup(10);
  const read = () => (lookup(1) + lookup.table.tag) | 0;
  const ref = new WeakRef(lookup.table);
  work += read() + other(1);
  return [ref, work];
}
const [ref, work] = main();
let turns = 0;
const ask = () => {
  Bun.gc(true);
  if (++turns < 5) { setTimeout(ask, 1); return; }
  console.log(work, ref.deref() === undefined, process.memoryUsage().arrayBuffers < 10_000_000);
};
setTimeout(ask, 1);
