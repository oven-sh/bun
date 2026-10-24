// Closures made in for, for-of and while loops, in callbacks, behind an await and behind a yield keep the variables of their own turn, also where only one of them outlives the loop.
const fs = [];
for (let i = 0; i < 3; i++) { fs.push(() => i); i += 0; }
console.log(fs.map(f => f()).join());
const gs = [];
for (let i = 0; i < 3; i++) { let j = i * 2; const inc = () => ++j; inc(); gs.push(() => j, inc); }
console.log(gs.map(f => f()).join());
function each(n, cb) { for (let i = 0; i < n; i++) cb(i); }
let keep = []; each(3, i => { let x = i; keep.push(() => x++); });
console.log(keep.map(f => f() + f()).join());
function later() { const out = []; for (const k of ["a", "b"]) { let c = 0; const bump = () => (c++, k + c); bump(); out.push(bump); } return out; }
console.log(later().map(f => f()).join());
function loop() { let saved; for (let i = 0; i < 4; i++) { const f = () => i; if (i === 1) saved = f; f(); } return saved(); }
console.log(loop());
function w() { let r = []; let i = 0; while (i < 3) { let v = i; r.push(function () { return v; }); v += 10; i++; } return r.map(f => f()); }
console.log(w().join());
async function as() { const r = []; for (let i = 0; i < 3; i++) { await null; r.push(() => i); } return r.map(f => f()).join(); }
as().then(console.log);
function* gen() { for (let i = 0; i < 3; i++) { yield () => i; } }
console.log([...gen()].map(f => f()).join());
