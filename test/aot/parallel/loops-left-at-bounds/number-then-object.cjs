// The smallest form: what is read at the head is a number in the first iteration and an object in the others.
function* f9() { let p = 0, i = 0; do { p = { x: p.y }; if (i === 4) break; i++; } while (globalThis.k--); return [p]; }
globalThis.k = 7;
console.log(JSON.stringify(f9().next()));
function* f10() { let p = 0, i = 0; do { p = { x: p.y, y: p.y }; if (i === 4) break; i++; } while (globalThis.k--); return [p]; }
globalThis.k = 7;
function go(f) { try { return f(); } catch (e) { return String(e); } }
console.log(JSON.stringify(go(() => { const it = f10(); return it.next(); })));
console.log(JSON.stringify(go(() => { const it = f10(); return it.next(); })));
