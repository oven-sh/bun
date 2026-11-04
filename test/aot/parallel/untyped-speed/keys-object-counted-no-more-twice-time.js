// The own keys of an object are counted as its values are: by what its layout lists. Neither makes a list, and neither asks the run time.
// COUNT: arrivals = 0
// COUNT: branches <= 2600
// COUNT: operations <= 300
// COUNT: cells <= 200
const shape = { a: 1, b: 2, c: 3, d: 4, e: 5 };
function countKeys(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += Object.keys(shape).length + (i & 1);
  return sum;
}
function countValues(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += Object.values(shape).length + (i & 1);
  return sum;
}
console.log(countKeys(1000), countValues(1000));
