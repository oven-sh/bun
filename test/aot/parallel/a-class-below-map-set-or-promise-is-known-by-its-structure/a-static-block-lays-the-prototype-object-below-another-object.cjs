// A static block lays the prototype object of the class below another object while the class is being defined: the guard ends, and the examination finds another link than the built-in's.
// COUNT: counter:StructuresOfHeirsRefused >= 1
"use strict";
const other = { get(k) { return -1; }, has(k) { return false; }, get size() { return 50; } };
class H extends Map { static { Object.setPrototypeOf(this.prototype, other); } look(k) { return this.get(k); } count() { return this.size; } }
const one = new H(); Map.prototype.set.call(one, 1, 1);
let a = 0, b = 0, c = 0;
for (let t = 0; t < 300; t++) { a += one.look(1); b += one.get(1); c += one.count(); }
console.log(a, b, c);
