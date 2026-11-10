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
class Mine extends Array {} both("an heir", () => Mine.from([1, 5, 3])); both("a set", () => new Set([1, 5, 3])); both("a text", () => "153"); both("a view", () => new Float64Array([1.5, 5.5, 3.5])); both("a map's keys", () => new Map([[1, 0], [5, 0]]).keys()); both("a generator", () => (function* () { yield 1; yield 5; })()); both("arguments", () => (function () { return arguments; })(1, 5, 3)); both("a proxy", () => new Proxy([1, 5, 3], {})); both("null", () => null); both("a number", () => 5); both("an object", () => ({ length: 2, 0: 1, 1: 5 }));
}
console.log(out.join("\n"));
