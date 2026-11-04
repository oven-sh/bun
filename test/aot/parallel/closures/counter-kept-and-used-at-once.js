// COUNT: operation:operationAOTMaterializeDeferredClosure <= 19
// An object of closures over the scope that made it, which is kept and used at once. The closures are made beside the reads that want them, not in the run time.
function counter(start) {
  let n = start;
  return {
    add(by) {
      return (n += by);
    },
    get() {
      return n;
    },
    reset() {
      n = start;
    },
  };
}
const kept = [];
function turn(i) {
  const c = counter(i);
  kept[i & 3] = c;
  c.add(2);
  c.add(3);
  return c.get();
}
let total = 0;
for (let i = 0; i < 2000; i++) total += turn(i & 7);
kept[0].reset();
console.log(total, kept.map(c => c.get()).join());
