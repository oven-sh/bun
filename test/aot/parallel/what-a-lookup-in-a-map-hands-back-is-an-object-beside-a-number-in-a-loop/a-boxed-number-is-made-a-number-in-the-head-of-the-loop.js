const g = new Map([[1, new Number(4)]]);
function f(k) { let n = 0; while ((+g.get(k)) && n < 3) n++; return n; }
try { console.log(f(1)); } catch (e) { console.log(e.constructor.name); }
