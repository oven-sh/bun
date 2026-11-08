const g = new Map([[1, new Date(7)]]);
function f(k) { let n = 0, t; while (n < 3) { t = +g.get(k); n++; } return String(t); }
try { console.log(f(1)); } catch (e) { console.log(e.constructor.name); }
