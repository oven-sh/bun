// Sums in counted loops: invariants of fields, caches and closures, elements under masks, joined and wide terms. The sums pass 2 ** 53, begin at -0, fractions and NaN, and outlast one stretch between polls.
const show = x => (Object.is(x, -0) ? "-0" : String(x));
const out = [];
const starts = [0, -0, 0.5, -3, 2 ** 51, 2 ** 52 + 1, 2 ** 53 - 9, -(2 ** 53) + 5, NaN, Infinity, 4503599627370495.5];
const turns = [0, 1, 7, 8, 9, 100, (1 << 20) + 9, 2500003];
function run(f) { for (const n of starts) for (const t of [turns[out.length % 8], turns[(out.length * 3 + 5) % 8]]) out.push(show(f(t, n))); }

const object = { v: 3 };
function ofField(t, n) { for (let k = 0; k < t; k++) n += object.v; return n; }
for (const v of [3, -0, 0.5, 2147483647, -2147483648, 4294967296, 2 ** 53, NaN, undefined, null, 7]) { object.v = v; run(ofField); }

class Lazy { t = null; get table() { return (this.t ??= [1, 2147483647, -5, 4]); } }
const lazy = new Lazy();
function ofTable(t, n) { for (let k = 0; k < t; k++) n += lazy.table[k & 3]; return n; }
run(ofTable); lazy.t = null; run(ofTable); lazy.t.length = 2; run(ofTable); lazy.t = [1, , 3, 4]; run(ofTable); lazy.t = [1, 2.5, 3, 4]; run(ofTable);

function bound(a, b) { return this.v + a + b; }
const holder = { v: 1 };
const g = bound.bind(holder, 2), h = bound.bind({ v: 2147483647 }, 2147483647);
function ofBound(t, n) { for (let k = 0; k < t; k++) n += g(k & 7); return n; }
function ofWide(t, n) { for (let k = 0; k < t; k++) n += h(k & 7); return n; }
run(ofBound); holder.v = 1.5; run(ofBound); holder.v = -2147483648; run(ofBound); holder.v = 2147483648; run(ofBound); run(ofWide);

function once(f) { let d = false, v; return (...a) => { if (!d) { d = true; v = f(...a); } return v; }; }
const first = once(x => x + 1), negated = once(x => x * -1), half = once(x => x + 0.5);
function ofOnce(t, n) { for (let k = 0; k < t; k++) n += first(k); return n; }
function ofNegated(t, n) { for (let k = 0; k < t; k++) n += negated(k); return n; }
function ofHalf(t, n) { for (let k = 0; k < t; k++) n += half(k); return n; }
run(ofOnce); run(ofNegated); run(ofHalf);

const list = []; for (let i = 0; i < 1000; i++) list.push(i * 7);
function reduced() { return list.reduce((a, b) => a + b, 0); }
out.push(reduced()); list[500] = -0; out.push(reduced()); list[7] = 2 ** 31; out.push(reduced()); list[9] = 0.5; out.push(reduced()); delete list[3]; out.push(reduced()); list.length = 5; out.push(reduced());
function untilLarge(t, n) { for (let k = 0; k < t; k++) { if (k > 1200000) break; n += object.v; } return n; }
function joined(t, n) { for (let k = 0; k < t; k++) n += k & 1 ? k : 3; return n; }
object.v = 9; run(untilLarge); run(joined);
let hash = 0; for (const line of out) for (let i = 0; i < String(line).length; i++) hash = (hash * 31 + String(line).charCodeAt(i)) | 0;
console.log(out.length, hash); console.log(out.join(" "));
