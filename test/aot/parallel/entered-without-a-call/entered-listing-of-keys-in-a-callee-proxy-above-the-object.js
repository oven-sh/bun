// A callee goes through the names of what it is handed by for-in, the program has laid one such object below a Proxy whose traps write a field of another object, and the caller looks at that field before and behind.
const holder = { n: 0 };
function make() { return { a: 1, b: 2 }; }
function hostile() { const o = make(); Object.setPrototypeOf(o, new Proxy({ c: 3 }, { ownKeys(target) { holder.n++; return Reflect.ownKeys(target); } })); return o; }
function middle(s) { let names = ""; for (const k in s) names += k; return names; }
function outer(s) { const before = holder.n; const names = middle(s); const behind = holder.n; return before + ">" + behind + ":" + names; }
function looped(s) { let t = ""; for (let i = 0; i < 3; i++) { middle(s); t += holder.n + ","; } return t; }
console.log(outer(make()), outer(hostile()), looped(hostile()));
