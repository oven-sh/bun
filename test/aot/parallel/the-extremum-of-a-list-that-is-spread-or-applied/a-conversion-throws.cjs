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
const log = []; both("the second of three", () => [{ valueOf() { log.push("a"); return 1; } }, { valueOf() { log.push("b"); throw new RangeError("mine"); } }, { valueOf() { log.push("c"); return 3; } }]); both("toString alone", () => [1, { toString() { return "8"; } }]); both("neither", () => [1, Object.create(null)]); both("toPrimitive", () => [1, { [Symbol.toPrimitive](hint) { log.push(hint); return 6; } }]); out.push("log " + log.join());
}
console.log(out.join("\n"));
