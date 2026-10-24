// `f(...list)` and `[...list]`: the elements of a list of known objects stay known behind the spread.
function first(a, b, c) {
  return a.weight + b.weight + (c ? c.weight : 0);
}
const list = [{ weight: 1 }, { weight: 2 }, { weight: 3 }];
let total = 0;
for (let i = 0; i < 2000000; i++) {
  const copy = [...list];
  total += first(...copy) + copy[i % 3].weight;
}
console.log(total);
