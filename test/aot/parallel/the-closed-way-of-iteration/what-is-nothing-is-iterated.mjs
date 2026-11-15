const out = []; function say(x) { out.push(typeof x + ":" + String(x)); } function t(f) { try { say(f()); } catch (e) { out.push(e.name + ":" + e.message); } }
const un = v => [v][JSON.parse("0")];
function f(x) { let n = 0; for (const v of x) n++; return n; } for (const x of [undefined, null, 0, 1, true, {}, Symbol.iterator, [], "ab", new Set([1]), () => 1]) t(() => f(un(x))); t(() => f()); t(() => { let o; for (const v of o?.x) return 1; });
console.log(out.join("|"));
export {};
