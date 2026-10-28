// What the message of a refused call, construction or instanceof quotes where a variable that is used once, a constant or the length of a text stands in the expression.
const show = (label, run) => { try { console.log(label, run()); } catch (error) { console.log(label, error.name, error.message); } };
const o = { a: 1, b: { c: 2 } };
function h() {}
show("length", () => "abc".length());
show("new length", () => new ("abc".length)());
show("once", () => { const f = o.a; return f(); });
show("once name", () => { const g = o; const f = g; return f(); });
show("once member", () => { const g = o; return g.a(); });
show("once deep", () => { const g = o.b; return g.c(); });
show("once new", () => { const g = o; return new g.a(); });
show("once new name", () => { const g = o; return new g(); });
show("constant", () => { const f = 5; return f(); });
show("constant text", () => { const f = "t"; return f(); });
show("constant key", () => { const k = "a"; return o[k](); });
show("constant index", () => { const k = 1; return o[k](); });
show("let once", () => { let f = o.b; return f.c(); });
show("twice", () => { const f = o.a; return [f, f()]; });
show("instanceof once", () => { const g = o; return 1 instanceof g; });
show("instanceof length", () => 1 instanceof "abc".length);
show("instanceof sum", () => o instanceof (1 + 2));
