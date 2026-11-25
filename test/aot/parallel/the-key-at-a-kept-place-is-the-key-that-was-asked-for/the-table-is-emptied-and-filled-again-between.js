const keys = JSON.parse('["a", "zz", "other"]');
function refilled() { const m = new Map(); m.set("a", 1); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { m.clear(); m.set("other", 9); s += m.get(k) + ";"; } } return s; }
function refilledWithTexts() { const m = new Map(); m.set("a", "one"); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { m.clear(); m.set("other", "nine"); s += m.get(k) + ";"; } } return s; }
function deletedAndAnotherAdded() { const m = new Map(); m.set("a", 1); m.set("b", 2); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (m.has(k)) { m.delete(k); m.delete("b"); m.set("c", 7); m.set("d", 8); s += m.get(k) + ";"; } } return s + m.size; }
console.log("SAID " + [refilled(), refilledWithTexts(), deletedAndAnotherAdded()].join(" | "));
