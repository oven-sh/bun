// `const m = require(..)` of different modules in sibling and nested blocks under the same name.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("sibling blocks", () => { let r = []; { const m = require("./files/a"); r.push(m.x); } { const m = require("./files/b"); r.push(m.x); } return r.join(); });
row("sibling blocks, the other order", () => { let r = []; { const m = require("./files/b"); r.push(m.x); } { const m = require("./files/a"); r.push(m.x); } return r.join(); });
row("nested blocks", () => { let r = []; { const m = require("./files/a"); r.push(m.x); { const m = require("./files/b"); r.push(m.x); } r.push(m.x); } return r.join(); });
row("three deep", () => { let r = []; { const m = require("./files/a"); { const m = require("./files/b"); { const m = require("./files/a"); r.push(m.x); } r.push(m.x); } r.push(m.x); } return r.join(); });
row("the same module twice", () => { let r = []; { const m = require("./files/a"); r.push(m.x); } { const m = require("./files/a"); r.push(m.x); } return r.join(); });
row("a block, then the function's own", () => { let r = []; { const m = require("./files/a"); r.push(m.x); } const m = require("./files/b"); r.push(m.x); return r.join(); });
row("the function's own, then a block", () => { let r = []; const m = require("./files/b"); r.push(m.x); { const m = require("./files/a"); r.push(m.x); } r.push(m.x); return r.join(); });
row("two functions", () => { const f = () => { const m = require("./files/a"); return m.x; }, g = () => { const m = require("./files/b"); return m.x; }; return f() + g() + f(); });
row("a function in a block of a function", () => { const m = require("./files/b"); { const m = require("./files/a"); return (() => { { const m = require("./files/b"); } return m.x; })(); } });
row("closures of both", () => { let f, g; { const m = require("./files/a"); f = () => m; } { const m = require("./files/b"); g = () => m; } return [f().x, g().x, f() === require("./files/a"), g() === require("./files/b"), f() === g()].join(); });
row("in both arms of an if", () => [1, 0].map((c) => { if (c) { const m = require("./files/a"); return m.x; } else { const m = require("./files/b"); return m.x; } }).join());
row("in two cases of a switch, each in a block", () => [1, 2].map((c) => { switch (c) { case 1: { const m = require("./files/a"); return m.x; } case 2: { const m = require("./files/b"); return m.x; } } }).join());
row("in try, catch and finally", () => { let r = []; try { const m = require("./files/a"); r.push(m.x); throw 0; } catch { const m = require("./files/b"); r.push(m.x); } finally { const m = require("./files/a"); r.push(m.x); } return r.join(); });
