// `let m = require(..)` that is later assigned another module or object, directly or by a closure.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("let stored to", () => { { let m = require("./files/a"); const first = m.x; m = require("./files/b"); return first + m.x; } });
row("let stored to with an object", () => { { let m = require("./files/a"); m = { x: "set" }; return m.x; } });
row("let stored to by a closure", () => { { let m = require("./files/a"); const set = () => { m = { x: "set" }; }; const first = m.x; set(); return first + m.x; } });
row("the outer stored to behind the block", () => { let m = { x: "outer" }; { const m = require("./files/a"); } m = { x: "set" }; return m.x; });
row("the outer stored to ahead of the block", () => { let m = { x: "outer" }; m = { x: "set" }; let inside; { const m = require("./files/a"); inside = m.x; } return inside + m.x; });
row("the outer stored to by a closure called in the block", () => { let m = { x: "outer" }; const set = () => { m = { x: "set" }; }; let inside; { const m = require("./files/a"); set(); inside = m.x; } return inside + m.x; });
row("a property stored in the block", () => { const m = { x: "outer" }; let o; { const m = require("./files/c"); m.y = "changed"; o = m; } return [m.y, o.y, require("./files/c").y].join(); });
row("a property of the outer stored behind the block", () => { const m = { x: "outer" }; { const m = require("./files/c"); } m.z = "changed"; return [m.z, require("./files/c").z].join(); });
row("the inner let stored to, an outer let around", () => { let m = { x: "outer" }; { let m = require("./files/a"); m = { x: "set" }; } return m.x; });
row("a parameter stored to behind the block", () => ((m) => { { const m = require("./files/a"); } m = "set"; return m; })("parameter"));
row("increment of the outer", () => { let m = 1; { const m = require("./files/a"); } m++; return m; });
