// A callee calls pop on a list one element of which the program has defined by a getter that writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
function make() { const list = []; Object.defineProperty(list, 0, { get() { holder.n++; return 9; }, configurable: true, enumerable: true }); return list; }
function middle(list) { return list.pop(); }
function outer(list) { const before = holder.n; const got = middle(list); const behind = holder.n; return before + ">" + behind + ":" + got + ":" + list.length; }
function looped() { let s = ""; for (let i = 0; i < 3; i++) { middle(make()); s += holder.n + ","; } return s; }
console.log(outer(make()), looped(), outer([7]));
