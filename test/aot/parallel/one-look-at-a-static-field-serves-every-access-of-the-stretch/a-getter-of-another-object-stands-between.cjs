// A read by name of something else runs a getter that makes the class whole.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms >= 1
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; }
let calls = 0;
const other = through({ get sly() { calls++; if (calls === 50) Tally.extra = 1; if (calls === 90) Tally.count = -1000; return 1; } });
function mix(turns) { let sum = 0; for (let i = 0; i < turns; i++) { Tally.count = Tally.count + other.sly; sum = (sum + Tally.count) | 0; } return sum; }
tell(() => mix(200)); tell(() => Tally.count + ":" + Object.keys(Tally).join());
console.log(said.join(" | "));
