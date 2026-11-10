// A lookup whose answer only feeds a throw that the handler ignores is passed by only while it is the built-in's: a get of the class and an own has must run.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
let ran = 0;
class H extends Map { probe(k) { try { throw new Error(this.get(k)); } catch { return 1; } } asked(k) { try { throw this.has(k); } catch { return 2; } } }
const one = new H(); one.set(1, 1); let sum = 0;
for (let t = 0; t < 400; t++) { sum += one.probe(1) + one.asked(1); if (t === 150) H.prototype.get = function (k) { ran++; return 0; }; if (t === 250) one.has = function () { ran += 10; return false; }; }
console.log(sum, ran);
