// A function with a loop over objects of an heir is called once, over no turns, in front of the statements that set up the base and the heir. No class is defined by that call: behind the set-up the loop makes no object.
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
function turn(i) { return new Heir(i & 7).area(); }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn(i)) | 0; return sum; }
const early = run(JSON.parse("0"));
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 300000);
console.log(early + run(turns));
