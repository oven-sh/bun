// A callee subtracts what it is handed, one caller hands it an object whose valueOf writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
function make() { return { valueOf() { holder.n++; return 3; } }; }
function middle(a, b) { return a - b; }
function outer(a) { const before = holder.n; const got = middle(a, 1); const behind = holder.n; return before + ">" + behind + ":" + got; }
function looped(a) { let s = ""; for (let i = 0; i < 3; i++) { middle(a, i); s += holder.n + ","; } return s; }
console.log(outer(5), outer(make()), looped(make()));
