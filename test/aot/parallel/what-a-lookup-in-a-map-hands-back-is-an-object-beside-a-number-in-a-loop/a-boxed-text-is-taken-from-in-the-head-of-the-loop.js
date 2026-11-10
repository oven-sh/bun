const g = new Map([[1, new String("5")]]);
function f(a, k) { let n = 0; while ((g.get(k) - a) && n < 3) n++; return n; }
try { console.log(f(0, 1)); } catch (e) { console.log(e.constructor.name); }
