"use strict";
// Small functions of which the front end expects a list of numbers (they read and store p[i]) are called in loops with what the caller has made itself and what is no list: views of every make, a text, a record with numeric names, a record with accessors, an arguments object, null and undefined; with an index that is no int32; with too few and too many arguments.
const out = [];
function invert(p, i) { p[i] = 255 - p[i]; p[i + 1] = 255 - p[i + 1]; }
function sum(p, i) { return p[i] + p[i + 1]; }
function scale(p, i, by) { p[i] = p[i] * by; return arguments.length; }
globalThis.kept = [invert, sum, scale];
function views(turns) { let s = 0; const a = new Uint8ClampedArray(8), b = new Int8Array(8), c = new Float64Array(8), d = new Uint16Array(8), e = new BigInt64Array(8); for (let i = 0; i < turns; i++) { invert(a, i & 3); invert(b, i & 3); invert(c, i & 3); invert(d, i & 3); s += sum(a, i & 3) + sum(b, i & 3) + sum(c, i & 3) + sum(d, i & 3); try { invert(e, i & 3); } catch (x) { s += x instanceof TypeError ? 1 : 1000; } } return s + "|" + [...a, ...b, ...c, ...d].join(); }
function others(turns) { const seen = []; const text = "abcdef", record = { 0: 1, 1: 2, 2: 3 }, spy = { get 0() { seen.push("g0"); return 7; }, set 0(v) { seen.push("s0:" + v); }, get 1() { seen.push("g1"); return 9; }, set 1(v) { seen.push("s1:" + v); } }; let s = ""; for (let i = 0; i < turns; i++) { s += sum(text, i) + ","; invert(record, i & 1); invert(spy, 0); try { invert(text, 0); } catch (x) { s += x.constructor.name; } s += sum(record, 0) + ";"; } return s + seen.join() + JSON.stringify(record); }
function nothing(turns) { let s = ""; for (let i = 0; i < turns; i++) { try { invert(null, i); } catch (x) { s += x.constructor.name + ":" + /null/.test(x.message); } try { sum(undefined, i); } catch (x) { s += x.constructor.name; } try { sum(); } catch (x) { s += x.constructor.name; } } return s; }
function indexes(turns) { const a = new Uint8ClampedArray(4).fill(3); let s = ""; for (let i = 0; i < turns; i++) { s += sum(a, i / 2) + "," + sum(a, -1) + "," + sum(a, "1") + "," + sum(a, 2 ** 32) + "," + sum(a, NaN) + "," + sum(a) + ";"; invert(a, 0.5); invert(a, "2"); invert(a, -0); } return s + [...a].join() + Object.keys(a).join(); }
function counts(turns) { const a = new Float32Array(4).fill(2); let s = 0; for (let i = 0; i < turns; i++) s += scale(a, i & 3) + scale(a, i & 3, 2, 3, 4) * 10 + scale(a) * 100; return s + "|" + [...a].join(); }
function lists(turns) { const l = [1, 2, 3, 4], holes = [1, , 3], mixed = [1, "2", 3]; let s = ""; for (let i = 0; i < turns; i++) { invert(l, i & 1); s += sum(l, i & 1) + "," + sum(holes, i & 1) + "," + sum(mixed, i & 1) + ";"; } return s; }
function own() { let s = 0; for (let i = 0; i < 3; i++) s += sum(arguments, i); return s; }
for (const f of [views, others, nothing, indexes, counts, lists]) out.push(f(3), f(0));
out.push(own(1, 2, 3, 4));
console.log(out.join("\n"));
