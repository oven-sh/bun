// Math.max | Math.min called with a list of arguments: where the walk has no plan of its own for the call, a function of the prelude goes over the numbers of that list; anything else in it, and a long list, goes as written.
// STATISTIC: LibraryFunctionsCalledDirectly >= 2
// Under: --aot-testing=CheckProofsAtRunTime: the empty word of a hole stands in no value of which a type is proven
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
both("in integers", () => [1, , 3]); both("in doubles", () => [1.5, , 3.5]); both("in cells", () => ["1", , 3]); both("at the end", () => { const l = [1, 2]; l.length = 4; return l; }); both("all", () => new Array(3)); both("deleted", () => { const l = [4, 5, 6]; delete l[1]; return l; });
}
console.log(out.join("\n"));
