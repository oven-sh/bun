// A list with a length and no places: the first place is a hole.
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
both("only a length", () => new Array(5));
}
for (const line of out) console.log("SAID " + line);
