// Stored by key enters code that has an effect (list), and a caller of the function that holds it looks at the state before and behind.
const log = [];
class C { set x(v) { log.push(1); } }
function make() { return new C(); }
function middle(c, k) { c[k] = 1; }
function outer(c) { const before = log.length; middle(c, "x"); const behind = log.length; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += log.length + ","; } return s; }
console.log(outer(make()), looped(make()));
