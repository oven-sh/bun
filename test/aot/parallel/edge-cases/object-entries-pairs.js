// A pair that `Object.entries` yields holds the key, a string, and the value.
function f() { const v = { a: 1, b: { c: 2 } }; return Object.entries(v).map(p => p[0] + String(p[1])).join(); }
function g() { const like = { length: 1, 0: { x: "ex", z: "zed" } }; return Array.from(like).map(o => String(o.x) + String(o.z)).join(); }
for (const h of [f, g]) { try { console.log(h.name, h()); } catch (e) { console.log(h.name, "THROWS", e.name + ": " + e.message.slice(0, 90)); } }
