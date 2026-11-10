// The twin: no loop stands anywhere in this program: every access looks for itself, not one byte more.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms = 0
"use strict";
class Tally { static count = 1; }
function once(by) { Tally.count += by; return Tally.count * 2; }
function twice(by) { const before = Tally.count; Tally.count = before + by; Tally.count = Tally.count + by; return before + Tally.count; }
console.log(once(1), once(2), twice(3), twice(4), Tally.count);
