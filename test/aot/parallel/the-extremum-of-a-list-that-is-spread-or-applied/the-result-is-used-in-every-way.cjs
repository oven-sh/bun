// Math.max | Math.min of a list that is spread or applied: every use of the result, and the order in which the operands are evaluated.
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
function spreadOf(values) { return Math.max(...values) - Math.min(...values); }
function tail(values) { return Math.max(...values); }
function unused(values) { Math.max(...values); return values.length; }
function twice(values) { return Math.max(...values, ...values); }
function withMore(values) { return Math.max(0, ...values) + Math.min(...values, 100); }
function chained(values) { return Math.max?.(...values); }
for (const list of [[3, 9, 1], [2.5, -1.5], [], ["4", 2]]) out.push([spreadOf(list), tail(list), unused(list), twice(list), withMore(list), chained(list)].map(show).join(" "));
console.log(out.join("\n"));
