// `if (w && o === undefined) o = {..}` is no default of o: without w the read throws.
function f(o, w) { if (w && o === undefined) o = { a: 1 }; return o.a; }
try { console.log(f({ a: 2 }, true), f(undefined, false)); } catch (e) { console.log(e.name); }
