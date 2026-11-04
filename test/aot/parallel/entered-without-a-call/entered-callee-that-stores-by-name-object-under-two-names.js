// A callee stores into the object that it is handed, which its caller also holds under another name, and the caller looks through that other name before and behind.
function make() { return { n: 0 }; }
function middle(c) { c.n = c.n + 1; }
function outer(a, b) { const before = a.n; middle(b); const behind = a.n; return before + ">" + behind; }
function looped(a, b) { let s = ""; for (let i = 0; i < 3; i++) { middle(b); s += a.n + ","; } return s; }
const one = make();
const other = make();
console.log(outer(one, one), outer(make(), make()), looped(other, other));
