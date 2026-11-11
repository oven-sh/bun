class Row { constructor(n) { this.n = n; } [Symbol.iterator]() { let i = 0; const n = this.n; return { next() { return i < n ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { i = n; return { done: true, value: undefined }; } }; } }
function drive(it) { let out = ""; for (;;) { const step = it.next; const stop = it.return; const r = step.call(it); if (r.done) break; out += r.value; if (out.length > 3) { stop.call(it); break; } } return out; }
let sum = 0; for (const v of new Row(4)) sum += v;
const strange = new Function("let i = 0; return { next() { return i < 6 ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { return {}; } };");
console.log(sum, drive(strange()), drive(strange()));
