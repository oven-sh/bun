// Inner functions that call each other and capture constants of their maker: made twice, in a loop, in the cases of a switch, in a recursion, in a generator, behind an await, handed to another function. And a variable that holds a function gets another one while a closure that calls through it lives on.
const out = [];
function pair(n) { const k = n * 2; function a(d) { return d ? b(d - 1) + k : k; } function b(d) { return d ? a(d - 1) + n : n; } return [a, b]; }
const [a1, b1] = pair(1), [a2, b2] = pair(10); out.push(a1(3), b1(3), a2(3), b2(3), a1(0), b2(0));
function again(n) { let f = function () { return n; }; const g = () => f() + 1; const first = g(); f = function () { return n * 100; }; return [first, g(), f()]; }
out.push(...again(2), ...again(3));
function inLoop() { const r = []; for (let i = 0; i < 3; i++) { const c = i * 10; function up() { return c + down(); } function down() { return i; } r.push(up, down); } return r.map(f => f()); }
out.push(...inLoop());
function twice(flag) { let h; const base = flag ? 5 : 7; if (flag) h = () => base + 1; else h = () => base + 2; const call = () => h(); const x = call(); h = () => base + 3; return [x, call()]; }
out.push(...twice(true), ...twice(false));
function recursive(n) { const mine = n; function inner() { return mine; } function outer() { return inner() + (n ? recursive(n - 1)() : 0); } return outer; }
out.push(recursive(4)());
function* steps() { for (let i = 0; i < 3; i++) { const v = i + 100; const read = () => v; const both = () => read() + i; yield both; } }
out.push(...[...steps()].map(f => f()));
function inSwitch(k) { switch (k) { case 1: { const z = 11; function one() { return z + two(); } function two() { return k; } return one(); } default: { const z = 22; function one() { return z - two(); } function two() { return k; } return one(); } } }
out.push(inSwitch(1), inSwitch(2));
function late(n) { const use = () => helper() + n; let helper = () => 1; const r1 = use(); { const m = n + 1; helper = () => m; } const r2 = use(); return [r1, r2]; }
out.push(...late(5));
function counter() { let c = 0; const inc = () => ++c; const get = () => c; const both = () => inc() + get(); return [both(), both(), get()]; }
out.push(...counter());
function handed(cb) { return cb(); } function gives(n) { const w = n + 0.5; function leaf() { return w; } function mid() { return handed(leaf) + leaf(); } return mid(); }
out.push(gives(1), gives(2));
async function waits(n) { const q = n * 3; const r = () => q; const s = async () => { await null; return r() + n; }; return (await s()) + (await s()); }
waits(2).then(v => { out.push(v); let t = 0; for (let i = 0; i < 20000; i++) { const [x, y] = pair(i & 7); t += x(2) + y(1); } out.push(t); console.log(out.join(" ")); });
