function main() {
  let big = null;
  const read = () => big.tag;
  const write = (next) => { big = next; };
  write({ tag: 3, bytes: new Uint8Array(50_000_000) });
  class Reader { tag() { return big.tag; } tag() { return 7; } }
  const seven = new Reader().tag();
  return { ref: new WeakRef(big), read, write, seven };
}
let made = main();
console.log(made.read(), made.seven);
const ref = made.ref;
made = null;
let turns = 0;
const ask = () => {
  Bun.gc(true);
  if (++turns < 5) { setTimeout(ask, 1); return; }
  console.log(ref.deref() === undefined, process.memoryUsage().arrayBuffers < 10_000_000);
};
setTimeout(ask, 1);
