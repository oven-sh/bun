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
for (const n of JSON.parse("[1000,65534,65535,65536,65537,70000,130000,300000]")) { both("integers " + n, () => Array.from({ length: n }, (_, i) => (i * 7919) % 10007)); both("doubles " + n, () => Array.from({ length: n }, (_, i) => ((i * 7919) % 10007) + 0.5)); }
console.log(out.join("\n"));
