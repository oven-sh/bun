// Heir.count finds the field above: whoever files that answer makes the class above whole.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms >= 0
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; static rows = [1, 2, 3]; } class Heir extends Tally {}
function mix(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const before = Tally.count; const seen = Heir.count; Tally.count = before + 1; sum = (Math.imul(sum, 31) + seen + Tally.count) | 0; } return sum; }
function lists(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const before = Tally.count; for (let k = 0; k < Heir.rows.length; k++) sum = (sum + Heir.rows[k]) | 0; Tally.count = before + 1; sum = (Math.imul(sum, 31) + Tally.count) | 0; } return sum; }
function once(by) { const before = Tally.count; const seen = Heir.rows.length; Tally.count = before + by; return seen + Tally.count; }
tell(() => mix(400)); tell(() => Tally.count + ":" + Object.keys(Tally).join()); tell(() => lists(400)); tell(() => Tally.count); tell(() => once(through(2)) + ":" + once(through(3))); tell(() => Object.getOwnPropertyNames(Tally).join());
console.log(said.join(" | "));
