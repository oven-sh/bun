// A variable is compared with itself, and the answer decides over a store to that variable: in a loop, behind an assignment, and as the last half of a hand-written Object.is.
function a(start, other) { let n = start; for (let turn = 0; turn < 3; turn++) { console.log(n); if (n === n) n = other; console.log(n + 0); } }
function b(start, other) { let n = start; for (let turn = 0; turn < 3; turn++) { console.log(n); if (n !== n) n = other; console.log(n + 0); } }
function c(start, other) { let n = start; for (let turn = 0; turn < 3; turn++) { console.log(n); if (n == n) n = other; console.log(n + 0); } }
function d(start, other) { let n = start; for (let turn = 0; turn < 3; turn++) { console.log(n); if (n != n) n = other; console.log(n + 0); } }
function e(start, other) { let n = start; n = other; if (n === n) console.log("same", n); else console.log("differs", n); return n !== n; }
function f(start, other) { let n = start; let k = 0; while (n === n && k < 3) { n = k === 1 ? other : n; k++; } return [n, k]; }
function g(x, y) { return (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y); }
for (const start of [1.5, NaN, 0, -0, "text", undefined, null, {}, 7n])
  for (const other of [undefined, null, "s", NaN, 2, {}]) {
    if (typeof start !== "bigint") { a(start, other); b(start, other); c(start, other); d(start, other); }
    console.log(e(start, other), String(f(start, other)), g(start, other), g(start, start), g(other, other));
  }
