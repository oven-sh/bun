// STATISTIC: CalleeConstantsReadBefore >= 4
// Functions that read objects of constants of the file, called in loops: before the constant is initialized, beside stores of the same fields, with fields added and deleted, accessors, frozen objects, replaced prototypes and calls between.
const out = [];
const say = (...values) => { out.push(values.map(v => Object.is(v, -0) ? "-0" : typeof v === "function" ? "f" : String(v)).join(" ")); };
function early(n) { let t = 0; for (let k = 0; k < n; k++) t += level(k); return t; }
function level(k) { return k > flags.level ? flags.step : 0; }
try { say(early(3)); } catch (error) { say(error.constructor.name, error.message); }
say(early(0));
const flags = { debug: false, trace: false, level: 2, step: 3 };
say(early(6));
let traced = 0;
function log(l, x) { if (flags.debug && l > flags.level) traced += x; }
function run(n) { let t = 0; for (let k = 0; k < n; k++) { log(k & 3, k); t += k & 7; } return t; }
say(run(40), traced); flags.debug = true; say(run(40), traced); flags.level = 0; say(run(40), traced);
function change(n) { let t = 0; for (let k = 0; k < n; k++) { if (k === 5) flags.step = 10; if (k === 9) flags.step = "s"; t += level(k + 3); } return t; }
say(change(12)); flags.step = 1; say(change(4));
const nested = { inner: { scale: 2, get twice() { return this.scale * 2; } }, list: [1, 2, 3] };
function scale(x) { return x * nested.inner.scale + nested.inner.twice + nested.list[x % 3]; }
function total(n) { let t = 0; for (let k = 0; k < n; k++) t += scale(k); return t; }
say(total(10)); nested.inner = { scale: 5, twice: 0.5 }; say(total(10)); nested.list = [0.5]; say(total(10));
const ops = { add: (a, b) => a + b, sub: (a, b) => a - b, mul(a, b) { return a * b * this.factor; }, factor: 2 };
function calc(k) { return k & 1 ? ops.add(k, 3) : k & 2 ? ops.sub(k, 3) : ops.mul(k, 2); }
function all(n) { let t = 0; for (let k = 0; k < n; k++) t += calc(k); return t; }
say(all(20)); ops.add = (a, b) => a * 100 + b; say(all(20)); Object.freeze(ops); say(all(20));
const open = { a: 1 }; function read() { return open.a + (open.b ?? 10); }
function grow(n) { let t = 0; for (let k = 0; k < n; k++) { t += read(); if (k === 3) open.b = 4; if (k === 6) delete open.b; if (k === 8) Object.setPrototypeOf(open, { b: 100 }); if (k === 10) delete open.a; } return t; }
say(grow(9)); say(grow(13)); say(Object.keys(open));
let count = 0; const watched = { get value() { count++; return count; }, set value(v) { count += v; } };
function take() { watched.value = 2; return watched.value; }
function watch(n) { let t = 0; for (let k = 0; k < n; k++) t += take(); return t; }
say(watch(5), count);
const deep = { n: 0 }; function visit(d) { if (d > deep.n) deep.n = d; let t = 0; for (let k = 0; k < 3 && d < 4; k++) t += visit(d + 1) + deep.n; return t; }
say(visit(0), deep.n);
console.log(out.join("\n"));
