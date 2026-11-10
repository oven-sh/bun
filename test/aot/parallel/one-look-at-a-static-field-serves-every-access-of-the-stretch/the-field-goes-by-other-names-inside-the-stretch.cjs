// this.count in a static method, a second name for the class, a key written as a text, super.count.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms >= 0
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Tally { static count = 1; static viaThis() { const before = Tally.count; this.count = before + 2; return Tally.count; } }
class Heir extends Tally { static viaSuper() { const before = Tally.count; super.count = before + 3; return Tally.count + ":" + Object.hasOwn(Heir, "count"); } }
const Other = Tally;
function viaOther(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const before = Tally.count; Other.count = before + 1; sum = (Math.imul(sum, 31) + Tally.count) | 0; } return sum; }
function viaText(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const before = Tally.count; Tally["count"] = before + 1; sum = (Math.imul(sum, 31) + Tally.count) | 0; } return sum; }
function viaUnknown(turns, same) { let sum = 0; for (let i = 0; i < turns; i++) { const before = Tally.count; same.count = before + 1; sum = (Math.imul(sum, 31) + Tally.count) | 0; } return sum; }
tell(() => Tally.viaThis()); tell(() => viaOther(300)); tell(() => viaText(300)); tell(() => viaUnknown(300, through(Tally))); tell(() => Heir.viaSuper()); tell(() => Tally.count);
console.log(said.join(" | "));
