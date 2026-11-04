// A callee calls push on an object of a class below Array whose own push writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
class Counted extends Array { push(x) { holder.n++; return super.push(x); } }
function middle(list, x) { list.push(x); }
function outer(list) { const before = holder.n; middle(list, 1); const behind = holder.n; return before + ">" + behind + ":" + list.length; }
function looped(list) { let s = ""; for (let i = 0; i < 3; i++) { middle(list, i); s += holder.n + ","; } return s; }
console.log(outer(new Counted()), looped(new Counted()), outer([]));
