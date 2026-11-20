// The first object of a constructor function is made, and its method called, in a function that a loop calls in each turn. In one turn a setter for a field comes onto the prototype of the base.
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 3000);
const second = function () { return 1000 + this.a; };
function turn(i) { return new Heir(i & 7).area(); }
let sum = 0, taken = 0;
for (let i = 0; i < turns; i++) { if (i === 1000) Object.defineProperty(Base.prototype, "b", { set(value) { taken++; }, get() { return 50; }, configurable: true }); sum = (sum + turn(i)) | 0; }
console.log(sum, taken);
