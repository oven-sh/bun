// valueOf deletes the field between the read and the store: the store lays it anew, behind the other names.
// STATISTIC: StaticFieldGuardsReused >= 0
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; static other = 2; }
let calls = 0;
const sly = { valueOf() { calls++; if (calls === 40) delete Tally.count; return 2; } };
function raise(turns, by) { let sum = 0; for (let i = 0; i < turns; i++) { Tally.count = Tally.count + by; sum = (sum + Tally.count) | 0; } return sum; }
tell(() => raise(100, 1)); tell(() => raise(100, through(sly))); tell(() => Tally.count); tell(() => Object.keys(Tally).join());
console.log(said.join(" | "));
