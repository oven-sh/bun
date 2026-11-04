// A callee that is handed objects of a base class and of the class below it stores into a field, and a caller that knows its object by the class below looks at the field before and behind.
class Base { constructor() { this.n = 0; } }
class Below extends Base { constructor() { super(); this.k = 1; } }
function middle(c) { c.n = c.n + 1; }
function outer() { const c = new Below(); keep(c); const before = c.n; middle(c); const behind = c.n; return before + ">" + behind + ":" + c.k; }
function looped() { const c = new Below(); keep(c); let s = ""; for (let i = 0; i < 3; i++) { middle(c); s += c.n + ","; } return s; }
const kept = [];
function keep(c) { kept.push(c); }
middle(new Base());
console.log(outer(), looped(), kept.length);
