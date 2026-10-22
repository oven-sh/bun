// A function declaration with the same name as a parameter, a `var`, another function or `arguments`, in sloppy code. Plain Bun's transpiler declares no `var` for a function in a block (the row "in a block, sloppy, no parameter"), and plain Bun leaves the argument in `arguments[0]` where a function is declared over the parameter (the row "arguments shows it, strict": the directive of a function has no effect in a sloppy file, so `arguments` is mapped). In both rows the expected output follows ECMAScript.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
module.exports = {};
row("control: which mode this file is in", () => (function () { return this === undefined ? "strict" : "sloppy"; })());
// 1. over a parameter
row("the row itself", () => { function o(p) { let k = "late"; function p() { return k; } return p(); } return o(1); });
row("a const", () => { function o(p) { const k = "late"; function p() { return k; } return p(); } return o(1); });
row("a class", () => { function o(p) { class K { static x = "late"; } function p() { return K.x; } return p(); } return o(1); });
row("a var", () => { function o(p) { var k = "late"; function p() { return k; } return p(); } return o(1); });
row("called ahead of the let", () => { function o(p) { const early = said(p); let k = "late"; function p() { return k; } return early + " " + p(); } return o(1); });
row("called ahead of the var", () => { function o(p) { const early = said(p); var k = "late"; function p() { return k; } return early + " " + p(); } return o(1); });
row("the let stored to later", () => { function o(p) { let k = "first"; function p() { return k; } const a = p(); k = "second"; return a + p(); } return o(1); });
row("the function stores to the let", () => { function o(p) { let k = 0; function p() { return ++k; } p(); p(); return k; } return o(1); });
row("returned and called later", () => { function o(p) { let k = "late"; function p() { return k; } return p; } return o(1)(); });
row("two activations", () => { function o(p, v) { let k = v; function p() { return k; } return p; } const a = o(1, "a"), b = o(1, "b"); return a() + b() + a(); });
row("another parameter", () => { function o(p, q) { function p() { return q; } return p(); } return o(1, "q"); });
row("another parameter, stored to", () => { function o(p, q) { function p() { return q; } q = "set"; return p(); } return o(1, "q"); });
row("itself by name", () => { function o(p) { let n = 3; function p() { return n-- > 0 ? "x" + p() : ""; } return p(); } return o(1); });
row("the parameter stored to later", () => { function o(p) { let k = "late"; function p() { return k; } const f = p; p = 7; return f() + p; } return o(1); });
row("two functions over one parameter", () => { function o(p) { let k = "late"; function p() { return "first " + k; } function p() { return "second " + k; } return p(); } return o(1); });
row("a parameter in an object pattern", () => { function o({ p }) { let k = "late"; function p() { return k; } return p(); } return o({ p: 1 }); });
row("a parameter in an array pattern", () => { function o([p]) { let k = "late"; function p() { return k; } return p(); } return o([1]); });
row("a rest parameter", () => { function o(...p) { let k = "late"; function p() { return k; } return p(); } return o(1); });
row("a parameter with a default", () => { function o(p = 1) { let k = "late"; function p() { return k; } return p(); } return o(); });
row("an arrow in it", () => { function o(p) { let k = "late"; function p() { return (() => k)(); } return p(); } return o(1); });
row("a function in it", () => { function o(p) { let k = "late"; function p() { function q() { return k; } return q(); } return p(); } return o(1); });
row("arguments shows it, strict", () => { function o(p) { "use strict"; let k = "late"; function p() { return k; } return typeof arguments[0]; } return o(1); });
row("strict", () => { function o(p) { "use strict"; let k = "late"; function p() { return k; } return p(); } return o(1); });
row("a method", () => ({ o(p) { let k = "late"; function p() { return k; } return p(); } }).o(1));
row("a generator around", () => { function* o(p) { let k = "late"; function p() { return k; } yield p(); } return [...o(1)].join(); });
row("a generator over the parameter", () => { function o(p) { let k = "late"; function* p() { yield k; } return [...p()].join(); } return o(1); });
row("a let of a loop", () => { function o(p) { const r = []; for (let i = 0; i < 2; i++) r.push(() => i); let k = r; function p() { return k.map((f) => f()).join(); } return p(); } return o(1); });
row("this of the outer by an arrow", () => { function o(p) { const self = () => this.x; function p() { return self(); } return p(); } return o.call({ x: "this" }, 1); });
// 2. over a var
row("over a var with a value", () => { function o() { var p = 1; let k = "late"; function p() { return k; } return typeof p; } return o(); });
// 3. over another function
row("over another function", () => { function o() { let k = "late"; function p() { return "first " + k; } function p() { return "second " + k; } return p(); } return o(); });
row("over another function, other captures", () => { function o() { let a = "a", b = "b"; function p() { return a; } function p() { return b; } return p(); } return o(); });
row("over another function, called ahead", () => { function o() { const early = said(p); let k = "late"; function p() { return 1; } function p() { return k; } return early + " " + p(); } return o(); });
// 4. in a block
row("in a block, sloppy, over a parameter", () => { function o(p) { let k = "late"; { function p() { return k; } } return typeof p; } return o(1); });
row("in a block, sloppy, read in it", () => { function o(p) { let k = "late"; { function p() { return k; } return p(); } } return o(1); });
row("in a block, sloppy, no parameter", () => { function o() { const early = typeof p; let k = "late"; { function p() { return k; } } return early + " " + p(); } return o(); });
row("in a block, sloppy, called ahead in the block", () => { function o() { { const early = said(p); let k = "late"; function p() { return k; } return early + " " + p(); } } return o(); });
row("in a block, strict", () => { function o(p) { "use strict"; let k = "late"; { function p() { return k; } k += p(); } return typeof p + " " + k; } return o(1); });
row("in an if, sloppy", () => { function o(p) { let k = "late"; if (p) { function p() { return k; } } return typeof p; } return o(1); });
row("in a block, over a let of the function", () => { function o() { let p = 1, k = "late"; { function p() { return k; } k += p(); } return p + " " + k; } return o(); });
// 5. over `arguments`
// 6. in a default's scope
row("a default's closure sees the parameter", () => { function o(p, q = () => p) { let k = "late"; function p() { return k; } return q() + " " + p(); } return o("argument"); });
row("a default's closure stores to the parameter", () => { function o(p, q = () => { p = "set"; }) { let k = "late"; function p() { return k; } q(); return p(); } return o("argument"); });
row("a default reads the parameter", () => { function o(p, q = p) { let k = "late"; function p() { return k; } return q + " " + p(); } return o("argument"); });
row("a default calls the parameter", () => { function o(p, q = p()) { let k = "late"; function p() { return k; } return q + " " + p(); } return o(() => "the argument's"); });
row("a function in a default of the name", () => { function o(p = function p() { return "default's"; }) { let k = "late"; function p() { return k; } return p(); } return o(); });
row("a default's closure, no function over it", () => { function o(p, q = () => p) { var p; return q() + " " + p; } return o("argument"); });
row("a default's closure, a var over it with a value", () => { function o(p, q = () => p) { var p = "var"; return q() + " " + p; } return o("argument"); });
