"use strict";
// Lists that variables of the file and captured variables hold are read in nests of loops while the text, a callee, an inner loop or a later line gives the variable another one.
let A = [1, 2, 3], B = [0.5, 1.5], C = ["a", "b"], calls = 0; const out = []; function other() { calls++; A = calls & 1 ? [4, 5, 6] : [1.5, 2.5, 3.5]; }
function nest(n) { let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) s += A[j]; for (let j = 0; j < 2; j++) { s += B[j]; if (i === 2 && j) B = [2, 3]; } for (let j = 0; j < 3; j++) { s += A[j] * B.length; } if (i === 1) other(); } return s; }
function captured(n) { let L = [1, 2], M = L, s = 0; const set = v => { L = v; }, get = k => L[k]; for (let i = 0; i < n; i++) { for (let j = 0; j < 2; j++) { s += L[j] + get(j); } if (i === 1) set([0.5, 7]); for (let j = 0; j < 2; j++) { s += M[j]; for (let k = 0; k < 2; k++) s += L[k] - M[k]; } if (i === 3) M = ["x", "y"]; } return s; }
function stored(n) { let s = ""; for (let i = 0; i < n; i++) { s += C[0] + C[1] + C.length; C[i & 1] = i; if (i === 2) C = [i, "z"]; s += C[0]; } return s; }
function two(n) { let s = 0; for (let i = 0; i < n; i++) s += B[i & 1]; for (let i = 0; i < n; i++) { s += B[i & 1]; B = [i, i + 1]; } for (let i = 0; i < n; i++) s += B[i & 1]; return s; }
function handlers(n) { let s = 0; for (let i = 0; i < n; i++) { try { for (let j = 0; j < 3; j++) { s += A[j]; if (i === 2) { A = null; } } } catch (e) { s += 100; A = [9, 9, 9]; } } return s; }
for (let r = 0; r < 12; r++) for (const f of [nest, captured, stored, two, handlers]) { try { out.push(String(f(5))); } catch (e) { out.push(e.name); A = [1, 2, 3]; B = [0.5, 1.5]; C = ["a", "b"]; } }
console.log(calls, out.join("|"));
