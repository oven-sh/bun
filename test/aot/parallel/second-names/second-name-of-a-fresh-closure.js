// A variable that a fresh closure has captured is written by a call through a second name of the closure.
function counted(n) { let count = 0; const add = v => { count += v; }; let k = add; for (let i = 0; i < n; i++) { k(i); k = k; } return count; }
function chosen(c, v) { let a = 0, b = 100; const first = x => { a += x; }, second = x => { b += x; }; const k = c ? first : second; k(v); return a + ":" + b; }
function property(n) { const f = () => 1; f.n = 0; let k = f; for (let i = 0; i < n; i++) { k.n += i; k = k; } return f.n; }
function held(n) { const box = { n: 0 }; const add = v => { box.n += v; }; let k = add; for (let i = 0; i < n; i++) { k(i); k = k; } return box.n; }
function swapped(n) { let a = 0, b = 100; let p = v => { a += v; }, q = v => { b += v; }; for (let i = 0; i < n; i++) { p(i); const t = p; p = q; q = t; } return a + ":" + b; }
console.log(counted(0), counted(6), chosen(true, 3), chosen(false, 3), property(6), held(6), swapped(6));
let last = ""; for (let r = 0; r < 300; r++) last = [counted(6), chosen(r & 1, 3), property(6), held(6), swapped(6)].join(" ");
console.log(last);
