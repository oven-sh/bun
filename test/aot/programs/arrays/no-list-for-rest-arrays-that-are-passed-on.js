// 10,000 rounds of a function that is called through a value and passes its rest array on behind two values, `f(a, b, ...rest)`, to a function that takes two values by name and the others in a rest parameter.
// `reads` only reads its rest array; `keeps` keeps it, so one array a call has to be a cell, and no more than one.
// object-census.test.ts runs it without collections, so that the census at exit counts every array and every closure that was made. The output is that of plain Bun.
let sum = 0;
const kept = [];

function reads(a, b, ...rest) {
  let result = a.n + b.n + rest.length;
  for (let i = 0; i < rest.length; i++) result += rest[i].n;
  return result;
}

function keeps(a, b, ...rest) {
  kept.push(rest);
  return a.n + b.n + rest.length;
}

const table = {
  passesOnToReader(...args) {
    return reads(args.length ? one : two, two, ...args);
  },
  passesOnToKeeper(...args) {
    return keeps(one, two, ...args);
  },
};
const one = { n: 1 };
const two = { n: 2 };
const names = ["passesOnToReader", "passesOnToKeeper"];

for (let i = 0; i < 10000; i++) {
  const a = { n: i };
  sum += table[names[i % 1]](a, one, a) + table[names[1 - (i % 1)]](a, one, a, two);
}
console.log(sum, kept.length, kept[9999].length, kept[9999][0].n, new Set(kept).size);
