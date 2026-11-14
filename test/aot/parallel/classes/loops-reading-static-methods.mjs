// A loop that reads static methods keeps the static fields of the class in registers, also through heirs.
// STATISTIC: SubclassGuardsHoisted >= 2
class A { static count = 0; static made = 0; static make(n) { A.count = n; return new this(n); } static set(n) { A.count = n; } static step() { A.made++; return A.made; } constructor(n) { this.n = n; } }
class B extends A {}
function heir(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += B.make(k & 3).n + B.count; } return n; }
function own(turns) { let n = 0; for (let k = 0; k < turns; k++) { A.set(k & 3); n += A.count; } return n; }
function stepped(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += B.step() + A.made; } return n; }
function large(turns) { let n = 3000000000; for (let k = 0; k < turns; k++) { n += B.make(k & 3).n + B.count; } return n; }
function read(turns) { let x, n = 0; for (let k = 0; k < turns; k++) { x = B.set; A.count = k; n += A.count; } return n + typeof x; }
for (const turns of [0, 1, 30, 1000]) console.log(heir(turns), own(turns), stepped(turns), large(turns), read(turns), A.count, B.count, A.made);
