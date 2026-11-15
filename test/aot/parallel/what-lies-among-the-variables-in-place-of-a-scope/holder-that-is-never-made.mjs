// A helper with a table is captured by an arrow and by a constructor function. The constructor function stands in a branch that is not taken: its closure is never made, so nothing holds the helper but the arrow.
let collected = 0;
const registry = new FinalizationRegistry(() => { collected++; });
const kept = [];
function main(withClass) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const helper = (n) => (n + 2) | 0;
  helper.table = { size: 5 };
  registry.register(helper, 0);
  registry.register(helper.table, 0);
  if (withClass) {
    function Cat(n) { this.n = (helper(n) + helper.table.size) | 0; }
    Cat.prototype.read = function () { return this.n; };
    kept.push(Cat, new Cat(1).read());
  }
  const use = () => (helper(1) + helper.table.size) | 0;
  return (use() + work) | 0;
}
function dig(depth) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return depth > 0 ? (dig(depth - 1) + work) | 0 : 0; }
console.log(main(JSON.parse("false")), dig(200), kept.length);
for (let turn = 0; turn < 6; turn++) { Bun.gc(true); await new Promise((resolve) => setTimeout(resolve, 5)); }
console.log(collected >= 2);
