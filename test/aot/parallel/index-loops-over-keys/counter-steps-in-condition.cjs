
let calls = 0; function hand(l) { calls += l.length; if (calls > 40) l.pop(); } function change(o, k) { calls++; if (calls % 5 === 0) { o["n" + (calls & 1)] = calls; } if (calls % 7 === 0) delete o.c; }
function walk(a, b) { const r = [], into = {}, fns = []; const ks = Object.keys(a);  let i = ks.length; while (i--) { const k = ks[i]; r.push(k, a[k]); change(a, k); } for (const f of fns) r.push(f()); return r.join() + "|" + Object.keys(a).join() + "|" + Object.keys(into).join(); }
const make = [i => ({ a: i, b: 2, c: 3 }), i => ({ a: 1, b: i, c: 3 }), i => { const o = { c: 3, b: 2, a: i }; return o; }, i => ({ a: i, b: 2 }), i => ({ a: i, b: 2, c: 3, d: 4, e: 5 }), i => { const o = { a: i, b: 2, c: 3 }; o.z = 1; return o; }, i => JSON.parse('{"a":' + i + ',"b":2,"c":3}'), i => { const o = { a: i, b: 2, c: 3 }; Object.defineProperty(o, "b", { enumerable: false }); return o; }, i => { const o = { a: i, b: 2, c: 3 }; o[0] = "zero"; return o; }, i => ({})];
const lines = [];
for (let t = 0; t < 3; t++) for (let m = 0; m < make.length; m++) for (let q = 0; q < 3; q++) { try { lines.push(walk(make[m](t), make[(m + q) % make.length](t))); } catch (e) { lines.push(e.constructor.name); } }
for (const l of lines) console.log(l); console.log(calls);
function one(a, b) { const r = [], into = {}, fns = []; const ks = Object.keys(a);  let i = ks.length; while (i--) { const k = ks[i]; r.push(k, a[k]); change(a, k); } return r.length; }
let s = 0; for (let i = 0; i < 9; i++) { try { s += +one({ a: i, b: 2, c: 3 }, { a: 1, b: 2, c: 3 }) || 1; } catch (e) { s += 100; } } console.log(s);
