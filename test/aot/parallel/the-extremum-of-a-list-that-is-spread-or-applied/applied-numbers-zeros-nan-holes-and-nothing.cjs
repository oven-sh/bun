// Math.max | Math.min applied to a list: as written today; the answers are held.
// Under: --aot-testing=CheckProofsAtRunTime: the empty word of a hole stands in no value of which a type is proven
'use strict';
const out = [];
function show(value) { return Object.is(value, -0) ? "-0" : String(value); }
function both(label, make) {
  for (const which of ["max", "min"]) {
    let said;
    try { const list = make(); said = show(which === "max" ? Math.max.apply(null, list) : Math.min.apply(undefined, list)); } catch (error) { said = error.constructor.name + ": " + String(error.message).split(" (")[0]; }
    out.push(label + " " + which + " " + said);
  }
}
const rounds = JSON.parse("3");
for (let round = 0; round < rounds; round++) {
both("integers", () => [3, -7, 12]); both("doubles", () => [3.5, -7.25]); both("empty", () => []); both("zeros", () => [-0, 0]); both("zeros back", () => [0, -0]); both("nan", () => [1, NaN, 2]); both("a hole", () => [1, , 3]); both("a hole in doubles", () => [1.5, , 3.5]); both("null", () => null); both("undefined", () => undefined);
}
console.log(out.join("\n"));
