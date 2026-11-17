// A function with a loop over objects of a constructor function is called once, over no turns, in front of the statements that lay the method on the prototype. The class of the constructor function is not defined by that call: behind the set-up the loop makes no object.
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
function turn(i) { return new Made(i & 7).area(); }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) sum = (sum + turn(i)) | 0; return sum; }
const early = run(JSON.parse("0"));
function Made(a) { this.a = a; this.b = 2; }
Made.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 300000);
console.log(early + run(turns));
