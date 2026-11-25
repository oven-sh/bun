// Objects that variables of the file hold, changed by functions that loops call: in the file's own loops, in let variables that are replaced between and during loops, under two names, with fields set by branches.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const out = [];
const p = { x: 0, y: 0 };
function move(dx, dy) { p.x += dx; p.y += dy; if (p.x > 100) p.x = 0; if (p.y > 100) p.y = -0; }
for (let k = 0; k < 1000; k++) move(k & 1, k & 3);
out.push(show(p.x) + " " + show(p.y));
const flags = { on: false, count: 0 };
function toggle() { flags.on = !flags.on; if (flags.on) flags.count++; }
for (let k = 0; k < 101; k++) toggle();
out.push(flags.on + " " + flags.count);
let state = { n: 0, last: 0 };
function step(x) { state.n += x; state.last = x; }
function run(turns) { for (let k = 0; k < turns; k++) step(k & 3); }
run(9); out.push(show(state.n) + " " + state.last);
const first = state; state = { n: 10, last: 1 }; run(5); out.push(first.n + " " + state.n);
function replace(k) { if (k === 4) state = { n: 100, last: 2 }; state.n++; }
function swap(turns) { for (let k = 0; k < turns; k++) replace(k); }
swap(3); out.push(state.n); swap(9); out.push(state.n + " " + first.n);
const a = { n: 1 }, b = a;
function both(x) { a.n += x; b.n *= 2; }
for (let k = 0; k < 5; k++) both(k);
out.push(a.n);
for (let k = 0; k < 4; k++) { step(k); if (k === 2) state = first; }
out.push(first.n + " " + state.n);
console.log(out.join());
