// The plain case: one look, the store goes without one, the read behind it is what was stored.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms >= 1
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; }
function raise(turns) { let sum = 0; for (let i = 0; i < turns; i++) { Tally.count += 1; sum = (sum * 31 + Tally.count) | 0; } return sum; }
tell(() => raise(5000)); tell(() => Tally.count); tell(() => Object.keys(Tally).join());
console.log(said.join(" | "));
