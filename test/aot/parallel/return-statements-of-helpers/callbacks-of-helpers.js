// A wrapper passes its parameter on to a helper that calls it in a loop. The helper's own loop is versioned; a copy in the wrapper would not be.
// Without the loop of the helper it is 4.
// STATISTIC: WalkLoopsVersioned >= 6
function iteratee(value) {
  return typeof value == "function" ? value : object => object[value];
}
function sum(array, callback) {
  let index = -1;
  let result;
  while (++index < array.length) {
    const current = callback(array[index]);
    if (current !== undefined) result = result === undefined ? current : result + current;
  }
  return result;
}
function sumBy(array, callback) {
  return array && array.length ? sum(array, iteratee(callback)) : 0;
}
const items = [];
for (let k = 0; k < 60; k++) items.push({ price: ((k * 37) % 91) + 0.5, count: k % 6 });
const cost = item => item.price * item.count;
let total = 0;
for (let k = 0; k < 300; k++) total += sumBy(items, cost);
console.log(total, sumBy([], cost), sumBy(null, cost));
console.log(sumBy([{ price: "a", count: 1 }], cost), sumBy([{ price: 1n, count: 2n }], cost), sumBy([{ price: 2, count: undefined }, { price: 1, count: 1 }], cost));
try {
  sumBy([items[1], null], cost);
} catch (error) {
  console.log(error instanceof TypeError);
}
const frozen = Object.freeze([items[3], items[4]]);
console.log(sumBy(frozen, cost), sumBy([items[1], , items[2]].filter(Boolean), cost), sumBy(new (class extends Array {})(items[7], items[8]), cost));
