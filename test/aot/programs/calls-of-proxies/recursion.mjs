// A call of a Proxy answers as in plain Bun: recursion.
let depth = 0; const p = new Proxy(function f() { depth++; return p(); }, { apply(t, r, l) { return Reflect.apply(t, r, l); } }); try { p(); } catch (e) { console.log(e.name, depth > 100); }
