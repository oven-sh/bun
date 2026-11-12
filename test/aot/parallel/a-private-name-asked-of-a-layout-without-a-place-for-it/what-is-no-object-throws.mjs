class P { #x = 1; static is(o) { return #x in o; } }
const out = []; for (const o of [1, "a", null, undefined, true, Symbol.iterator, 5n]) { try { out.push(P.is(o)); } catch (e) { out.push(e.name + ": " + e.message); } }
console.log(out.join(" | "));
