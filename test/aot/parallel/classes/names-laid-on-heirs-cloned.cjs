class Round { constructor(n) { this.n = n; } m(z) { return z; } }
class Oval extends Round { }
function clone(o) { const made = new Oval(0); for (const q in o) made[q] = o[q]; return made; }
const early = clone(new Oval(5));
Oval.prototype.m = function () { return 2; };
const later = clone(new Oval(6));
console.log("cloned", Object.keys(early).join(), Object.keys(later).join(), later.m(), later.n);
