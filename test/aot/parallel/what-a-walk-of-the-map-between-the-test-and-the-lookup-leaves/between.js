const keys = JSON.parse('["a", "b", "zz", "c"]');
function walked() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { for (const [x, y] of m) s += y; s += m.get(k) * 100; } } return s; }
function written() { const m = new Map([["a", 1], ["b", 2], ["c", 3]]); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { for (const [x, y] of m) s += y; s += m.get(k) * 100; } } return s; }
function third() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { m.forEach((v, x, all) => { if (x === k) all.delete(x); }); s += m.get(k) + ";"; } } return s + m.size; }
function head() { const m = new Map(); m.set("a", 1); m.set("b", 2); let s = 0, k = keys[0]; while (m.has(k)) { s += m.get(k); m.delete(k); k = keys[s]; } return s + ":" + m.size; }
function and() { const m = new Map(); m.set("a", 0); m.set("b", 2); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; s += (m.has(k) && m.get(k)) + ";" + (m.get(k) ?? "none") + ";"; } return s; }
function* yielded() { const m = new Map(); m.set("a", 1); m.set("b", 2); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { yield [m, k]; s += m.get(k) + ";"; } } return s; }
function drive() { const g = yielded(); let step = g.next(); while (!step.done) { step.value[0].delete(step.value[1]); step = g.next(); } return step.value; }
console.log("SAID " + [walked(), written(), third(), head(), and(), drive()].join(" | "));
