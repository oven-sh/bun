function one() { throw new RangeError("r"); }
function two() { throw new TypeError("t"); }
const makers = [one, two];
function f(i) { using r0 = makers[i](); return 0; }
for (let i = 0; i < 2; i++) { try { console.log(f(i)); } catch (e) { console.log(e.name); } }
