// `const m = require(..)` in nested functions, arrows, methods and static blocks, inside the scope of another binding or parameter named `m`.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("a nested function's own", () => { const m = { x: "outer" }; function g() { const m = require("./files/a"); return m.x; } return g() + m.x; });
row("a nested arrow's block", () => { const m = { x: "outer" }; const g = () => { { const m = require("./files/a"); } return m.x; }; return g(); });
row("a parameter's default sees the outer", () => { const m = { x: "outer" }; function g(p = m.x) { const m = require("./files/a"); return p + m.x; } return g(); });
row("a parameter's default, a block in the body", () => { const m = { x: "outer" }; function g(p = m.x) { { const m = require("./files/a"); } return p + m.x; } return g(); });
row("a parameter and a block", () => { function g(m) { { const m = require("./files/a"); } return m; } return g("parameter"); });
row("a parameter and a block, read in a closure", () => { function g(m) { { const m = require("./files/a"); } return () => m; } return g("parameter")(); });
row("a method", () => { const m = { x: "outer" }; class C { f() { { const m = require("./files/a"); return m.x; } } g() { { const m = require("./files/a"); } return m.x; } } return new C().f() + new C().g(); });
row("a static block", () => { const m = { x: "outer" }; let r; class C { static { { const m = require("./files/a"); r = m.x; } r += m.x; } } return r; });
row("a static block's own", () => { const m = { x: "outer" }; let r; class C { static { const m = require("./files/a"); r = m.x; } } return r + m.x; });
row("a loop's body", () => { const m = { x: "outer" }; let r = ""; for (let i = 0; i < 2; i++) { const m = require("./files/a"); r += m.x; } return r + m.x; });
row("a while's body", () => { const m = { x: "outer" }; let r = "", i = 0; while (i++ < 2) { const m = require("./files/a"); r += m.x; } return r + m.x; });
row("the head of a for", () => { const m = { x: "outer" }; let r = ""; for (const m = require("./files/a"); !r; ) r += m.x; return r + m.x; });
row("a case without a block", () => { const m = { x: "outer" }; let r = ""; switch (1) { case 1: const m = require("./files/a"); r += m.x; } return r + m.x; });
row("a catch's body", () => { const m = { x: "outer" }; let r = ""; try { throw 0; } catch { const m = require("./files/a"); r += m.x; } return r + m.x; });
row("a catch parameter of the name, a require in a block of it", () => { let r = ""; try { throw { x: "thrown" }; } catch (m) { { const m = require("./files/a"); r += m.x; } r += m.x; } return r; });
row("a labelled block", () => { const m = { x: "outer" }; let r = ""; l: { const m = require("./files/a"); r += m.x; break l; } return r + m.x; });
row("a generator", () => { const m = { x: "outer" }; function* g() { { const m = require("./files/a"); yield m.x; } yield m.x; } return [...g()].join(); });
row("a getter of a literal", () => { const m = { x: "outer" }; return { get v() { { const m = require("./files/a"); } return m.x; } }.v; });
row("no binding outside at all", () => { { const m = require("./files/a"); } return typeof m; });
row("a global of the name", () => { globalThis.n = { x: "global" }; { const n = require("./files/a"); } const r = n.x; delete globalThis.n; return r; });
