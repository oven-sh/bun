// A function keeps what it is given in a variable of the function around it. Nothing reads the variable.
async function collect() {
  for (let round = 0; round < 8; round++) {
    await new Promise(done => setTimeout(done, 1));
    Bun.gc(true);
  }
}
let cleaned = 0;
const registry = new FinalizationRegistry(() => cleaned++);
function watch(value) {
  registry.register(value, 0);
  return value;
}
class Resource {
  constructor(n) {
    this.n = n;
  }
}
function main() {
  let kept = null;
  function keep(resource) {
    kept = resource;
  }
  keep(watch(new Resource(1)));
  return keep;
}
const keep = main();
await collect();
console.log("cleaned", cleaned, "of", 1, typeof keep);
