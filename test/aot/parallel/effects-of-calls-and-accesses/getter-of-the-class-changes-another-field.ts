// a read by name finds the getter of the class, which changes another field of the receiver and a variable of the module
let reads = 0;
class P { x = 1; get v() { reads = reads + 1; this.x = this.x + 1; return reads; } }
function deed(p: P) { const x = p.x; const seen = reads; const got = p.v; return x + " " + seen + " " + got + " " + p.x + " " + reads; }
const p = new P();
console.log(deed(p));
let all = "";
for (let i = 0; i < 4; i++) all += deed(p) + ";";
console.log(all);
console.log(deed(new P()));
