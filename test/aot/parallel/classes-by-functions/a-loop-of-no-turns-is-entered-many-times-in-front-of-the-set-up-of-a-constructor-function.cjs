// A function with a loop over objects of a constructor function is called many times, each time over no turns, in front of the call that lays the method on the prototype. The operation that begins the guards is not called at each of those entries; behind the set-up the loop makes no object.
// COUNT: operation:operationAOTBeginMemberGuards <= 4
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
function turn(i) { return new Made(i & 7).area(); }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn(i)) | 0; return sum; }
function install() { Made.prototype.area = function () { return this.a + this.b; }; }
function Made(a) { this.a = a; this.b = 2; }
const none = JSON.parse("0");
let early = 0;
for (let round = 0; round < 30000; round++) early += run(none);
install();
console.log(early + run(Number(process.argv[2] ?? 300000)));
