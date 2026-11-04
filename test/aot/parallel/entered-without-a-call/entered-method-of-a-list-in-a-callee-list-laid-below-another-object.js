// A callee calls push on a list that the program has laid below an object of its own, whose push writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
const above = { push(x) { holder.n++; return x; } };
function make() { const list = []; Object.setPrototypeOf(list, above); return list; }
function middle(list, x) { list.push(x); }
function outer(list) { const before = holder.n; middle(list, 1); const behind = holder.n; return before + ">" + behind + ":" + list.length; }
function looped(list) { let s = ""; for (let i = 0; i < 3; i++) { middle(list, i); s += holder.n + ","; } return s; }
console.log(outer(make()), looped(make()), outer([]));
