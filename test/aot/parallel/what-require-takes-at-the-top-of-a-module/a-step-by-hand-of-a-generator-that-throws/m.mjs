async function* g() { throw new Error("x"); } let v; try { await g().next(); } catch (e) { v = e.message; } export { v };
