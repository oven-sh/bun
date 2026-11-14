// What is defined in front of a step in a turn is read behind the loop, in a closure at its end, in the next turn, in an exit of the front itself.
function* g(n) { for (let i = 0; i < n; i++) yield i; return "end" + n; }
const lines = [];
function afterLoop(n) { const it = g(n); let c = 0, x; for (;;) { x = c * 3; const r = it.next(); if (r.done) break; c++; } return x; }
function inExit(n) { const it = g(n); let c = 0; while (true) { const x = c + 1; const r = it.next(); if (r.done) return x * 10; c++; } }
function inClosure(n) { const it = g(n); let c = 0; for (;;) { const x = { c }; const r = it.next(); if (r.done) return () => x.c; c += 2; } }
function inSum(n) { const it = g(n); let s = 0; for (;;) { const x = s + 1; const r = it.next(); if (r.done) return s + x; s += r.value; } }
function inFrontExit(n) { const it = g(n); let c = 0; while (true) { const x = c * 2; if (x > 6) return "left " + x; const r = it.next(); if (r.done) return "done " + c; c++; } }
function inNextTurn(n) { const it = g(n); let before = -1; let s = ""; while (true) { const x = s.length; const r = it.next(); if (r.done) break; s += r.value + ":" + before + " "; before = x; } return s; }
function inBody(n) { const it = g(n); let s = 0; let c = 0; do { const x = c * c; var r = it.next(); if (!r.done) s += r.value * x; c++; } while (!r.done); return s + ":" + r.value; }
function inBoth(n) { const it = g(n); let x = 0, y = 0; for (;;) { x = y + 1; y = x * 2; const { value, done } = it.next(); if (done) break; if (value === 3) continue; y -= value; } return x + ":" + y; }
function inArms(n) { const it = g(n); let c = 0; let x; while (c < 9) { if (c & 1) x = "odd" + c; else x = "even" + c; const r = it.next(); if (r.done) break; c++; } return x; }
function kept(n) { const it = g(n); const all = []; let c = 0; for (;;) { const x = [c]; all.push(x); const r = it.next(); if (r.done) return all.length + x[0]; c++; } }
for (let turn = 0; turn < 30; turn++) {
  for (const n of [0, 1, 2, 4, 7]) {
    const answers = [afterLoop(n), inExit(n), inClosure(n)(), inSum(n), inFrontExit(n), inNextTurn(n), inBody(n), inBoth(n), inArms(n), kept(n)];
    if (turn % 29 === 0) lines.push(answers.join(" | "));
  }
}
console.log(lines.join("\n"));
