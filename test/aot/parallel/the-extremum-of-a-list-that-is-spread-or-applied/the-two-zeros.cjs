// Math.max | Math.min called with a list of arguments: where the walk has no plan of its own for the call, a function of the prelude goes over the numbers of that list; anything else in it, and a long list, goes as written.
// STATISTIC: LibraryFunctionsEnteredBehindRows >= 2
'use strict';
const out = [];
function show(value) { return Object.is(value, -0) ? "-0" : String(value); }
function both(label, make) {
  for (const which of ["max", "min"]) {
    let said;
    try { const list = make(); said = show(which === "max" ? Math.max(...list) : Math.min(...list)); } catch (error) { said = error.constructor.name + ": " + String(error.message).split(" (")[0]; }
    out.push(label + " " + which + " " + said);
  }
}
const rounds = JSON.parse("3");
for (let round = 0; round < rounds; round++) {
both("minus then plus", () => [-0, 0]); both("plus then minus", () => [0, -0]); both("minus alone", () => [-0]); both("minus twice", () => [-0, -0]); both("among negatives", () => [-1, -0, -2]); both("among positives", () => [1, -0, 0, 2]); both("doubles", () => [-0.0, 0.0, -0.5]); both("three", () => [0, -0, 0]); both("made", () => [1, 2].map(x => (x - 1) * -0));
}
console.log(out.join("\n"));
