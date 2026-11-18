class P { constructor(x) { this.x = x; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
function* each(n) { for (let i = 0; i < n; i++) yield make(P, i).x; }
async function later(n) { let s = 0; for (let i = 0; i < n; i++) { s += make(P, i).x; if (i === 1) await null; } return s; }
console.log([...each(Number("4"))].join(), await later(Number("5")));
