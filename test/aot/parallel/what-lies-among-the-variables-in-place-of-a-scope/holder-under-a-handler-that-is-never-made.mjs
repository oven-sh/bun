// The constructor function stands under a handler, behind a call that throws: its closure is never made, and the function goes on to its return. Nothing holds the helper but the arrow.
let collected = 0;
const registry = new FinalizationRegistry(() => { collected++; });
const kept = [];
function risky(flag) { if (flag) throw new Error("no"); }
function main(flag) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const helper = (n) => (n + 2) | 0;
  helper.table = { size: 5 };
  registry.register(helper, 0);
  registry.register(helper.table, 0);
  try {
    risky(flag);
    const Dog = function Dog(n) { this.n = (helper(n) + helper.table.size) | 0; };
    kept.push(Dog, new Dog(1).n);
  } catch (e) { work = (work + 1) | 0; }
  const use = () => (helper(1) + helper.table.size) | 0;
  return (use() + work) | 0;
}
function dig(depth) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return depth > 0 ? (dig(depth - 1) + work) | 0 : 0; }
console.log(main(JSON.parse("true")), dig(200), kept.length);
for (let turn = 0; turn < 6; turn++) { Bun.gc(true); await new Promise((resolve) => setTimeout(resolve, 5)); }
console.log(collected >= 2);
