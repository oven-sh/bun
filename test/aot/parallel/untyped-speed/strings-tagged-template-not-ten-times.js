// A tag function reads `strings[k]`. The strings object is frozen, and its strings are read as those of an array that the program wrote itself.
// COUNT: arrivals = 0
// COUNT: branches <= 4600
// COUNT: operations <= 300
// COUNT: cells <= 300
function lengths(strings, ...values) {
  let sum = 0;
  for (let k = 0; k < values.length; k++) sum += strings[k].length + values[k];
  return sum;
}
const written = ["a", "bc", "d"];
function tagged(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += lengths`a${i & 7}bc${2}d`;
  return sum;
}
function called(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += lengths(written, i & 7, 2);
  return sum;
}
console.log(tagged(1000), called(1000));
