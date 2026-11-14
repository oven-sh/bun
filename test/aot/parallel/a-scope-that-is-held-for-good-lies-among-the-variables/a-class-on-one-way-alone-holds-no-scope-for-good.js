function main(withClass) {
  let big = null;
  const read = () => big.tag;
  const write = (next) => { big = next; };
  write({ tag: 3, bytes: new Uint8Array(50_000_000) });
  if (withClass) { class Reader { get tag() { return big.tag; } } globalThis.kept = new Reader(); }
  return { ref: new WeakRef(big), read, write };
}
let made = main(Number("0") === 1);
console.log(made.read());
const ref = made.ref;
made = null;
let turns = 0;
const ask = () => {
  Bun.gc(true);
  if (++turns < 5) { setTimeout(ask, 1); return; }
  console.log(ref.deref() === undefined, process.memoryUsage().arrayBuffers < 10_000_000);
};
setTimeout(ask, 1);
