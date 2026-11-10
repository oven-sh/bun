// f() stands between: what it stores is lost, as the language says.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms >= 1
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; }
const table = [() => 1, () => { Tally.count = 500; return 1; }, () => { Tally.count = "text"; return 1; }];
function raise(turns, which) { const step = table[which]; let sum = ""; for (let i = 0; i < turns; i++) { Tally.count += step(); sum = Tally.count; } return sum; }
tell(() => raise(100, through(0))); tell(() => raise(100, through(1))); tell(() => raise(3, through(2))); tell(() => Tally.count);
console.log(said.join(" | "));
