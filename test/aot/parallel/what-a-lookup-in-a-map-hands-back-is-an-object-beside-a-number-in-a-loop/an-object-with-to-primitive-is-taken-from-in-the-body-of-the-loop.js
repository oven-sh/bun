const g = new Map([[1, { [Symbol.toPrimitive]() { return 3; } }]]);
function f(a, k) { let n = 0, t; while (n < 3) { t = g.get(k) - a; n++; } return String(t); }
try { console.log(f(0, 1)); } catch (e) { console.log(e.constructor.name); }
