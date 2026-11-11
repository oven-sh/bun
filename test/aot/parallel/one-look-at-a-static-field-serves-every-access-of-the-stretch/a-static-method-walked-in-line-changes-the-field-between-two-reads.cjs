// Tally.count + Tally.bump() + Tally.count.
// STATISTIC: StaticFieldGuardsReused >= 1
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; static bump() { Tally.count = (Tally.count + 5) | 0; return 1; } static drop() { delete Tally.count; return 1; } }
function mix(turns) { let sum = 0; for (let i = 0; i < turns; i++) sum = (sum + Tally.count + Tally.bump() + Tally.count) | 0; return sum; }
function last() { return String(Tally.count + Tally.drop() + Tally.count); }
tell(() => mix(500)); tell(() => Tally.count); tell(last); tell(() => "count" in Tally);
console.log(said.join(" | "));
