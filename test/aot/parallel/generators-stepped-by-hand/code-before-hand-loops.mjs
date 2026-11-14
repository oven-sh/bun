// Loops that step a generator by hand, with code between the call of the generator and the loop.
let state = 0;
const lines = [];
const show = v => (typeof v === "function" ? "function" : v instanceof Error ? v.name : typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const say = (...words) => lines.length < 3000 && lines.push(words.map(show).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]"), doubles = JSON.parse("[0.5,1.5,-2]");
function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* odd(a, b) { for (let k = a; k < b; k++) if (k & 1) yield k; }
function* pair(v) { yield v; state++; yield v + 1; state += 2; }
function* sends(v) { const a = yield v; const b = yield [a, v]; return [a, b]; }
function* guarded(v) { try { yield v; if (v === 4) throw new RangeError("four"); yield v + 1; } finally { state += 5; } }
function* throwing(v) { yield v; if (v > 4) throw new TypeError("large"); yield -v; }
function* nested(v) { for (let k = 0; k < 2; k++) { for (let j = 0; j < v % 3; j++) yield k * 10 + j; state++; } }
function* none() { state += 7; }
class Bag { constructor(v) { this.v = v; } *[Symbol.iterator]() { for (const x of this.v) yield x; } *some(n) { for (let k = 0; k < n; k++) yield this.v[k]; } }
const makers = [range, odd, pair, sends, guarded, throwing, nested, none];
const bump = v => { state += 3; return v; };
function collect(x) { const it = range(x, x + 4); const out = []; let r; while (!(r = it.next()).done) out.push(r.value); return say(out, r); }
function logged(x) { const it = pair(x); say("front", state); bump(x); for (let r = it.next(); !r.done; r = it.next()) say(r.value, state); return state; }
function thrown(x) { const it = guarded(x); if (x === 9) throw new Error("front"); let t = 0; while (true) { const r = it.next(); if (r.done) break; t += r.value; } return t; }
function made(x) { const it = odd(x, 12), seen = new Set(), box = { n: 0 }; let n = 0; for (;;) { const { value, done } = it.next(); if (done || n++ > 3) break; seen.add(value); box.n += value; } return say([...seen], box, n); }
function changed(x) { const o = { n: x }; const it = (function* () { yield o.n; o.n += 2; yield o.n; })(); o.n = 20; let t = 0, r; for (r = it.next(); !r.done; r = it.next(t)) t += r.value; return say(t, o, r); }
function defaulted(x) { const it = late(); state += 10; let t = ""; for (let r = it.next(); !r.done; r = it.next()) t += r.value + ","; return say(t, state); }
function* late(a = bump(state)) { yield a; yield state; }
function sentOn(x) { const it = sends(x); const given = []; let r = it.next(), c = 0; while (!r.done) { given.push(r.value); r = it.next(c++); } return say(given, r.value); }
function twice(x) { let t = 0; for (let z = 0; z < 2; z++) { const it = range(z, x); const add = v => { t += v; }; let r; while (!(r = it.next()).done) { if (r.value > 5) break; add(r.value); } say(t, z); } return t; }
for (let turn = 0; turn < 2; turn++) for (const x of list) for (const f of [collect, logged, thrown, made, changed, defaulted, sentOn, twice]) { try { say(f.name, f(x)); } catch (error) { say(f.name, error.message, state); } }
for (const line of lines) console.log(line);
console.log(lines.length, state);
