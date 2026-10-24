// A call of a Proxy answers as in plain Bun: recursion-without-trap.
let depth = 0; const p = new Proxy(function f() { depth++; return p() + 1; }, {}); try { p(); } catch (e) { console.log(e.name, depth > 100); }
