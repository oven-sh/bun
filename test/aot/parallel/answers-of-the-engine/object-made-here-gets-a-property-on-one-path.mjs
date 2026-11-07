// Behind a join the state has no note of a slot that one path has filled. Which keys an object has, and in which order, goes by its order word, which the paths leave different.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function show(o) { return Object.keys(o).join("") + ":" + o.a + "," + o.b + "," + o.c + "," + o.d; }
function make(i) { const p = { a: i }; if (i & 1) p.d = 4; if (i & 2) p.b = 2; if (i & 4) p.c = 3; return p; }
function copied(i) { const p = make(i); const s = { ...p }; return show(s) + " " + show(p); }
function inLoop(n) { const p = { a: 1 }; for (let i = 0;i < n; i++) p.b = i; const s = { ...p }; return show(s) + " " + show(p); }
function inLoopThenStore(n) { const p = { a: 1 }; for (let i = 0;i < n; i++) p.c = i; p.b = 5; p.d = 6; return show(p); }
function alternating(n) { const p = { a: 1 }; for (let i = 0;i < n; i++) { if (i & 1) p.b = i; else p.c = i; } p.d = 1; return show(p); }
function caught(fails) { const p = { a: 1 }; try { if (fails) throw 1; p.c = 2; } catch {} const s = { ...p }; p.b = 1; return show(s) + " " + show(p); }
function caughtBetween(fails) { const p = { a: 1 }; try { p.d = 2; if (fails) throw 1; p.c = 2; } catch { p.b = 3; } p.c = 4; return show(p); }
function switched(k) { const p = { a: 1 }; switch (k) { case 0: p.b = 1; case 1: p.c = 1; break; case 2: p.d = 1; } p.b = 2; p.c = 2; p.d = 2; return show(p); }
function twoNames(k) { const p = { a: 1 }; const q = { a: 2 }; const r = k ? p : q; r.b = 1; p.c = 1; q.d = 1; return show(p) + " " + show(q); }
function deleted(k) { const p = { a: 1, b: 2 }; if (k) delete p.b; p.c = 1; p.b = 3; return show(p); }
for (let i = 0;i < 8; i++) report(copied(i));
for (let i = 0;i < 8; i++) { const p = make(i); const s = { ...p }; report(Object.keys(s).join("")); }
function onlyCopied(i) { const p = { a: i }; if (i & 1) p.d = 4; if (i & 2) p.b = 2; const s = { ...p }; return Object.keys(s).join(""); }
for (let i = 0;i < 4; i++) report(onlyCopied(i));
for (let k = 0;k < 4; k++) { report(inLoop(k)); report(inLoopThenStore(k)); report(alternating(k)); report(caught(!!(k & 1))); report(caughtBetween(!!(k & 1))); report(switched(k)); report(twoNames(k & 1)); report(deleted(k & 1)); }
report("end");
