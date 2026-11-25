function f0(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s; }
function f1(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f0(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
function f2(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f1(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
function f3(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f2(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
function f4(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f3(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
function f5(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f4(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
function f6(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f5(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
function f7(...v) { let s = 0; for (let i = 0; i < v.length; i++) s += f6(v[i], 1, 2, 3, 4, 5, 6, 7); return s; }
console.log(f7(1, 2));
