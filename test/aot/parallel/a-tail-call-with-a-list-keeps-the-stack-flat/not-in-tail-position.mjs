function count() { return arguments.length; }
function second(first, hole) { return hole; }
let total = 0;
let holes = 0;
for (let round = 0; round < 300000; round++) {
  const list = [round, , 1];
  const counted = count.apply(null, list);
  total += counted;
  if (second.apply(null, list) === undefined) holes++;
}
const sparse = [1];
sparse[200000] = 0;
sparse.length = 6;
const row = [1.5, , 2.5, , 3.5, , 4.5];
function sum() { let s = 0; for (let i = 0; i < arguments.length; i++) s += arguments[i] === undefined ? 100 : arguments[i]; return s; }
const sums = [sum.apply(null, sparse), sum.apply(null, row), sum.apply(null, new Array(9)), sum.apply(null, [])];
console.log(total, holes, sums.join(" "));
