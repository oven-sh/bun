// @ts-nocheck
class D { x = eval("typeof arguments"); y = eval("new.target && new.target.name"); n = eval("arguments.length"); constructor(p?: number, q?: number) {} }
try { const d = new D(1, 2); console.log(d.x, d.y, d.n); } catch (e) { console.log(e.name, e.message); }
// bun run (base8): object D 2 . the executable: SyntaxError Unexpected identifier 'arguments'. arguments is not valid in this context.
