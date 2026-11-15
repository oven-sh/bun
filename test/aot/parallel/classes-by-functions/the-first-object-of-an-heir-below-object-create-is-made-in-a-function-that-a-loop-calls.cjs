// The prototype of Heir is made by Object.create out of the prototype of Base. The first object is made in a function that a loop calls in each turn: the guards of the constructor function are begun and asked in front of the loop, and no object is built.
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
function turn(i) { return new Heir(i & 7).area(); }
const turns = Number(process.argv[2] ?? 300000);
let sum = 0;
for (let i = 0; i < turns; i++) sum = (sum + turn(i)) | 0;
console.log(sum);
