// Calling `size` of a Set or Map as if it were a method throws a TypeError.
function t(f) { try { return f(); } catch (e) { return e.constructor.name; } }
console.log(t(() => new Set(["a"]).size?.("a")), t(() => new Map([["a", 1]]).size("a")), t(() => { const s = new Set(["a", "b"]); return (0, s.size)?.("a"); }));
const only = new Set(["a", "b"]);
console.log(only.has("a"), only.has("c"), only.size);
