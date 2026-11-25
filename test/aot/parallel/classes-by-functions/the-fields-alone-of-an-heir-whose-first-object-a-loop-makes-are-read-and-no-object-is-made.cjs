// An heir calls its base by `Base.call(this, ..)`. Its first object is made in a function that a loop calls in each turn, and only its fields are read: no method of the heir is called. No object is made.
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
function turn(i) { const made = new Heir(i & 7); return made.a + made.b; }
const turns = Number(process.argv[2] ?? 300000);
let sum = 0;
for (let i = 0; i < turns; i++) sum = (sum + turn(i)) | 0;
console.log(sum);
