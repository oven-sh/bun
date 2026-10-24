// `const m = require(..)` in a block is read, tested with `typeof` or used by a closure before the declaration has run.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("a read ahead, in the block", () => { { const early = said(() => m.x); const m = require("./files/a"); return early + " " + m.x; } });
row("typeof ahead", () => { { const early = said(() => typeof m); const m = require("./files/a"); return early + " " + typeof m; } });
row("a closure called ahead", () => { { const f = () => m.x; const early = said(f); const m = require("./files/a"); return early + " " + f(); } });
row("a function declaration called ahead", () => { { const early = said(g); const m = require("./files/a"); function g() { return m.x; } return early + " " + g(); } });
row("ahead of the second of a name", () => { { const m = require("./files/a"); } const early = said(() => m.x); const m = require("./files/a"); return early + " " + m.x; });
row("ahead of the second, another module", () => { { const m = require("./files/a"); } const early = said(() => m.x); const m = require("./files/b"); return early + " " + m.x; });
row("ahead of the second, by a function", () => { function g() { return m; } { const m = require("./files/a"); } const early = said(() => typeof g()); const m = require("./files/b"); return early + " " + g().x; });
row("ahead of the second, both in blocks", () => { { const m = require("./files/a"); } { const early = said(() => m.x); const m = require("./files/b"); return early + " " + m.x; } });
row("ahead of the first, a block behind", () => { const early = said(() => m.x); const m = require("./files/b"); { const m = require("./files/a"); } return early + " " + m.x; });
row("ahead, with an outer binding around", () => { const m = { x: "outer" }; { const early = said(() => m.x); const m = require("./files/a"); return early + " " + m.x; } });
row("ahead, a pattern", () => { { const { x: m } = require("./files/a"); } const early = said(() => m); const { x: m } = require("./files/b"); return early + " " + m; });
row("the value that gets out", () => { function g() { return m; } { const m = require("./files/a"); } const r = [said(() => g() === undefined), said(() => [g()].length), said(() => String(g()))].join(); const m = require("./files/b"); return r; });
row("let, ahead", () => { { const early = said(() => m.x); let m = require("./files/a"); return early + " " + m.x; } });
