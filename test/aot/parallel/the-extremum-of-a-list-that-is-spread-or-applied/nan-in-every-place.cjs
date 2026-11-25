// Math.max | Math.min called with a list of arguments: where the walk has no plan of its own for the call, a function of the prelude goes over the numbers of that list; anything else in it, and a long list, goes as written.
// STATISTIC: LibraryFunctionsCalledDirectly >= 2
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
both("first", () => [NaN, 1, 2]); both("middle", () => [1, NaN, 2]); both("last", () => [1, 2, NaN]); both("alone", () => [NaN]); both("among doubles", () => [1.5, 0 / 0, 2.5]); both("infinities", () => [Infinity, -Infinity, 1]); both("less", () => [Infinity - Infinity, 5]);
}
console.log(out.join("\n"));
