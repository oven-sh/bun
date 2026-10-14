// A function declaration with the same name as a `var` in the same function, in strict code.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("control: which mode this file is in", () => (function () { return this === undefined ? "strict" : "sloppy"; })());
row("over a var with a value, taken ahead", () => { function o() { const f = p; var p = 1; let k = "late"; function p() { return k; } return f() + " " + p; } return o(); });
row("over a var without a value", () => { function o() { var p; let k = "late"; function p() { return k; } return p(); } return o(); });
row("a var behind it", () => { function o() { let k = "late"; function p() { return k; } var p; return p(); } return o(); });
row("over a var, called ahead of the let", () => { function o() { var p; const early = said(p); let k = "late"; function p() { return k; } return early + " " + p(); } return o(); });
