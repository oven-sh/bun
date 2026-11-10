// valueOf lays a getter and a setter over the field between the read and the store.
// STATISTIC: StaticFieldGuardsReused >= 0
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; }
let calls = 0, heard = [];
const sly = { valueOf() { calls++; if (calls === 40) Object.defineProperty(Tally, "count", { get() { return 7; }, set(v) { heard.push(v); }, configurable: true }); return 2; } };
function raise(turns, by) { let sum = 0; for (let i = 0; i < turns; i++) { Tally.count = Tally.count + by; sum = (sum + Tally.count) | 0; } return sum; }
tell(() => raise(100, 1)); tell(() => raise(60, through(sly))); tell(() => Tally.count); tell(() => heard.length + ":" + heard.slice(0, 3).join());
console.log(said.join(" | "));
