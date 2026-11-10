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
both("texts", () => ["3", "12", "-7"]); both("a text among integers", () => [3, "12", -7]); both("no number", () => [1, "x", 2]); both("empty text", () => [1, "", -2]); both("booleans", () => [true, false, 3]); both("null", () => [null, -1, 1]); both("undefined", () => [undefined, 1]); both("bigint", () => [1, 2n, 3]); both("symbol", () => [1, Symbol("s"), 3]);
}
console.log(out.join("\n"));
