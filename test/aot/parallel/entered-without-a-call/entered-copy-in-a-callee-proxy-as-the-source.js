// A callee spreads what it is handed, one caller hands it a Proxy whose ownKeys trap writes a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
function make() { return { a: 1, b: 2 }; }
function hostile() { return new Proxy(make(), { ownKeys(target) { holder.n++; return Reflect.ownKeys(target); } }); }
function middle(s) { return { ...s }; }
function outer(s) { const before = holder.n; const copy = middle(s); const behind = holder.n; return before + ">" + behind + ":" + copy.a + copy.b; }
function looped(s) { let t = ""; for (let i = 0; i < 3; i++) { middle(s); t += holder.n + ","; } return t; }
console.log(outer(make()), outer(hostile()), looped(hostile()));
