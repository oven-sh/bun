const keys = JSON.parse('["a", "b", "zz", "c"]'), holders = JSON.parse('[{"id":"a"},{"id":"zz"},{"id":"c"}]');
function itself() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) s += m.get(k); } return s; }
function byName() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < holders.length; i++) { const o = holders[i]; if (m.has(o.id)) s += m.get(o.id); } return s; }
function otherHolder() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < holders.length; i++) { const o = holders[i], p = holders[(i + 1) % 3]; if (m.has(o.id)) s += m.get(p.id) ?? 0; } return s; }
function inFront() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; s += m.get(k) ?? 0; if (m.has(k)) s += 10; } return s; }
function handler() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; try { if (m.has(k)) throw k; } catch (e) { s += m.get(k); } } return s; }
function look(m, k) { return m.has(k) ? m.get(k) : -1; }
function inLine() { const m = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < keys.length; i++) s += look(m, keys[i]); return s; }
function two() { const m = new Map(), n = new Map(); m.set("a", 1); m.set("b", 2); m.set("c", 3); n.set("b", 20); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) s += n.get(k) ?? 0; } return s; }
function notAMap() { const m = new Map(), other = { get(x) { return 5; } }; m.set("a", 1); m.set("b", 2); m.set("c", 3); let s = 0; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) s += other.get(k); } return s; }
console.log("SAID " + [itself(), byName(), otherHolder(), inFront(), handler(), inLine(), two(), notAMap()].join(" | "));
