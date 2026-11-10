// this.constructor is the class, not Map: every prototype object is made with the name, and a data property of the built-in is never bound.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class H extends Map { kind() { return this.constructor; } again() { return new this.constructor(); } }
const one = new H(); let same = 0, heirs = 0;
for (let t = 0; t < 400; t++) { if (one.kind() === H) same++; if (one.again() instanceof H) heirs++; if (one.kind() === Map) same += 1000; }
console.log(same, heirs);
