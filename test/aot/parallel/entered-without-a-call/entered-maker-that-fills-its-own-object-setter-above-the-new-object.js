// A maker stores into the object that it has just made, a setter of the class answers to the name and writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
class Box { constructor() { this.b = 0; } set a(v) { holder.n += v; } }
function middle(v) { const o = new Box(); o.a = v; o.b = v; return o; }
function outer() { const before = holder.n; const made = middle(2); const behind = holder.n; return before + ">" + behind + ":" + made.b; }
function looped() { let s = ""; for (let i = 0; i < 3; i++) { middle(1); s += holder.n + ","; } return s; }
console.log(outer(), looped());
