// A callee assigns the properties of a plain object to a target above which a setter answers to one of the names, the setter writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
class Target { constructor() { this.b = 0; } set a(v) { holder.n += v; } }
function make() { return { a: 1, b: 2 }; }
function middle(t, s) { Object.assign(t, s); }
function outer(t, s) { const before = holder.n; middle(t, s); const behind = holder.n; return before + ">" + behind + ":" + t.b; }
function looped(t, s) { let r = ""; for (let i = 0; i < 3; i++) { middle(t, s); r += holder.n + ","; } return r; }
console.log(outer(new Target(), make()), looped(new Target(), make()));
