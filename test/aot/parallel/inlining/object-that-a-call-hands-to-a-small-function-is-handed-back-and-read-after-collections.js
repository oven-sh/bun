// an object that one call hands straight to a small function is handed back by it, kept by it or dropped by it, and is read again after the heap has been collected
let kept = null;
function load(i) { return { n: i, more: [i, i + 1] }; }
function pass(x) { return x; }
function keep(x) { kept = x; return x.n; }
function drop(x) { return x.n; }
function churn() { let last = null; for (let i = 0; i < 2000; i++) last = { a: [i], b: { c: i } }; if (typeof Bun !== "undefined") Bun.gc(true); return last.b.c; }
function subject(i) { const back = pass(load(i)); const n = keep(load(i + 1)); const d = drop(load(i + 2)); churn(); return back.n + back.more[1] + n + kept.more[0] + d; }
function deed(i) { return String(subject(i)); }
console.log(deed(1), deed(10));
let sum = 0;
for (let i = 0; i < 30; i++) sum += subject(i);
console.log(String(sum));
console.log(deed(JSON.parse("100")), String(kept.n));
