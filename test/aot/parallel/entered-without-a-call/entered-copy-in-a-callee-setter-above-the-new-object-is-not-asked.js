// A callee spreads a plain object into a literal that stands below an object with a setter under one of the names: the copy defines, so the setter is not asked, and the caller looks at the field that the setter would write before and behind.
const holder = { n: 0 };
const above = { set a(v) { holder.n += v; } };
function make() { return { a: 1, b: 2 }; }
function middle(s) { return { __proto__: above, ...s }; }
function outer(s) { const before = holder.n; const copy = middle(s); const behind = holder.n; return before + ">" + behind + ":" + copy.a + copy.b + Object.hasOwn(copy, "a"); }
function looped(s) { let t = ""; for (let i = 0; i < 3; i++) { middle(s); t += holder.n + ","; } return t; }
console.log(outer(make()), looped(make()));
