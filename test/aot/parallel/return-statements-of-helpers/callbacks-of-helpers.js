// A wrapper passes its parameter on to a helper that calls it in a loop. The helper's own loop is versioned; a copy in the wrapper would not be.
// Without the loop of the helper it is 4.
// STATISTIC: WalkLoopsVersioned >= 6
function asker(of) {
  if (typeof of !== "function") return crate => crate[of];
  return of;
}
function weigh(crates, ask) {
  let all = 0;
  let any = false;
  for (let at = 0; at < crates.length; at++) {
    const weight = ask(crates[at]);
    if (weight === undefined) continue;
    all = any ? all + weight : weight;
    any = true;
  }
  return any ? all : undefined;
}
function weightOf(crates, of) {
  if (!crates || crates.length === 0) return 0;
  return weigh(crates, asker(of));
}
const items = [];
for (let k = 0; k < 60; k++) items.push({ price: ((k * 37) % 91) + 0.5, count: k % 6 });
const cost = item => item.price * item.count;
let total = 0;
for (let k = 0; k < 300; k++) total += weightOf(items, cost);
console.log(total, weightOf([], cost), weightOf(null, cost));
console.log(weightOf([{ price: "a", count: 1 }], cost), weightOf([{ price: 1n, count: 2n }], cost), weightOf([{ price: 2, count: undefined }, { price: 1, count: 1 }], cost));
try {
  weightOf([items[1], null], cost);
} catch (error) {
  console.log(error instanceof TypeError);
}
const frozen = Object.freeze([items[3], items[4]]);
console.log(weightOf(frozen, cost), weightOf([items[1], , items[2]].filter(Boolean), cost), weightOf(new (class extends Array {})(items[7], items[8]), cost));
