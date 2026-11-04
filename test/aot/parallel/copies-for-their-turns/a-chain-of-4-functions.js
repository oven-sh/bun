function f0(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }
function f1(n) { let s = 0; for (let i = 0; i < n; i++) s += f0(8); return s; }
function f2(n) { let s = 0; for (let i = 0; i < n; i++) s += f1(8); return s; }
function f3(n) { let s = 0; for (let i = 0; i < n; i++) s += f2(8); return s; }
function f4(n) { let s = 0; for (let i = 0; i < n; i++) s += f3(8); return s; }
console.log(f4(8));
