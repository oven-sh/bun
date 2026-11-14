"use strict";
function storedAgain(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2, c: 3 }; try { delete o.b; if (i & 1) throw 1; o.b = 5; } catch { r += "caught" + o.b; } r += ("b" in o) + ";"; } return r; }
function storedInFinally(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; try { delete o.b; if (i & 1) throw 1; o.b = i; } catch { } finally { r += typeof o.b; } r += ("b" in o) + Object.keys(o).join() + ";"; } return r; }
function leftByBreak(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; for (;;) { delete o.b; r += o.b; if (i & 1) break; o.b = 5; break; } r += ("b" in o) + JSON.stringify(o) + ";"; } return r; }
function leftByLabel(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; out: { delete o.b; r += o.b ?? "none"; if (i & 1) break out; o.b = undefined; } r += ("b" in o) + Object.keys(o).length + ";"; } return r; }
function thrownInCall(n) { const boom = i => { if (i & 1) throw new Error("x"); }; let r = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; try { delete o.b; boom(i); o.b = 4; } catch { r += o.b; } r += ("b" in o) + ";"; } return r; }
for (const f of [storedAgain, storedInFinally, leftByBreak, leftByLabel, thrownInCall]) console.log(f.name, f(0), f(1), f(7));
