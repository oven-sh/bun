// A callee stores under the very name that its caller has read off the same object, and the caller looks at the field before and behind.
function make() { return { n: 0, m: 7 }; }
function middle(c) { c.n = c.n + 1; }
function outer(c) { const before = c.n; middle(c); const behind = c.n; return before + ">" + behind + ":" + c.m; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c); s += c.n + ","; } return s; }
console.log(outer(make()), looped(make()));
