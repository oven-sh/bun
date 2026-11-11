// Math.max | Math.min applied to a list: as written today; the answers are held.
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
const log = []; const o = (n) => ({ valueOf() { log.push(n); return n; } }); both("texts", () => ["3", "12"]); both("objects", () => [o(1), 9, o(5)]); both("grows", () => { const l = [1, { valueOf() { l.push(100); return 2; } }, 3]; return l; }); both("shrinks", () => { const l = [1, { valueOf() { l.length = 2; return 2; } }, 50]; return l; }); both("bigint", () => [1, 2n]); both("throws", () => [o(7), { valueOf() { throw new RangeError("mine"); } }, o(8)]); out.push("log " + log.join());
}
console.log(out.join("\n"));
