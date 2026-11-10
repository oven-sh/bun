// A static block lays a get and a has on the prototype object while the class is being defined: the guard of the class is armed in front of it and ends.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
"use strict";
class H extends Map { look(k) { return this.get(k); } asks(k) { return this.has(k); } static { this.prototype.get = function (k) { return -1; }; this.prototype.has = function () { return "mine"; }; } }
const one = new H(); Map.prototype.set.call(one, 1, 1);
let a = 0, b = 0, c = 0;
for (let t = 0; t < 300; t++) { a += one.look(1); b += one.get(1); c += one.asks(1) === "mine" ? 1 : 0; }
console.log(a, b, c);
