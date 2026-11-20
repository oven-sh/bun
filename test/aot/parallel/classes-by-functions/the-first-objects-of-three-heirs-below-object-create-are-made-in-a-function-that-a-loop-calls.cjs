// Three heirs, one of them below another, each with a prototype made by Object.create. The first object is made in a function that a loop calls in each turn: the guards of the constructor function are begun and asked in front of the loop, and no object is built.
// COUNT: operation:operationAOTAllocateSlow <= 50
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
function Other(a) { Base.call(this, a); this.c = 3; }
Other.prototype = Object.create(Base.prototype);
Other.prototype.constructor = Other;
Other.prototype.area = function () { return this.a + this.c; };
function Third(a) { Heir.call(this, a); this.d = 4; }
Third.prototype = Object.create(Heir.prototype);
Third.prototype.constructor = Third;
Third.prototype.area = function () { return this.a + this.d; };
function turn(i) { return new Heir(i & 7).area() + new Other(i & 3).area() + new Third(i & 1).area(); }
const turns = Number(process.argv[2] ?? 300000);
let sum = 0;
for (let i = 0; i < turns; i++) sum = (sum + turn(i)) | 0;
console.log(sum);
