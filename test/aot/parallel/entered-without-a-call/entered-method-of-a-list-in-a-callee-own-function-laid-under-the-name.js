// A callee calls push on a list on which the program has laid a function of its own under that name, which writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
function make() { const list = []; list.push = function (x) { holder.n++; return x; }; return list; }
function middle(list, x) { list.push(x); }
function outer(list) { const before = holder.n; middle(list, 1); const behind = holder.n; return before + ">" + behind + ":" + list.length; }
function looped(list) { let s = ""; for (let i = 0; i < 3; i++) { middle(list, i); s += holder.n + ","; } return s; }
console.log(outer(make()), looped(make()), outer([]));
