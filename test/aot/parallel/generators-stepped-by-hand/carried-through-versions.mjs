
const out = [];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v instanceof Error ? v.name + ":" + v.message : typeof v === "object" && v !== null ? (Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}") : typeof v === "string" ? JSON.stringify(v) : String(v);
function log(...v) { if (out.length < 500) out.push(v.map(show).join(" ")); }
let state = 0, saved = null; const kept = [];
const list = JSON.parse('[3,1,4,1,5,9,2,6]'), mixed = JSON.parse('[1,"a",null,2.5,[7]]');
const map = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]), set = new Set([2, 3, 5, 7]);
function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* talk(n) { let t = n; while (t < n + 5) { const got = yield t; t += got === undefined ? 1 : 2; } return t; }
function* guarded(n) { try { yield n; yield n + 1; if (n === 2) throw new Error("gen " + n); yield n + 2; } finally { state++; log("finally", n); } }
function* over(vs) { yield* vs; }
const written = n => { let k = 0; return { next() { k++; return { value: n + k, done: k > 3 }; } }; };
const watched = n => { let k = 0; return { next() { k++; const at = k; return { get done() { log("done", at); return at > 3; }, get value() { log("value", at); return n + at; } }; } }; };
const sharing = n => { let k = 0; const one = { value: n, done: false }; return { next() { one.value = n + ++k; one.done = k > 4; saved = one; return one; } }; };
const passing = it => ({ next(v) { const r = it.next(v); saved = r; return r; } });
const handing = it => ({ next(v) { return it.next(v); } });
const odd = (n, answers) => { let k = 0; return { next() { return answers[Math.min(k++, answers.length - 1)]; } }; };
const proxied = it => new Proxy(it, { get(t, key) { log("get", String(key)); const v = t[key]; return typeof v === "function" ? v.bind(t) : v; } });

function drain(it, most) { let s = ""; for (let r = it.next(); !r.done && most-- > 0; r = it.next()) s += show(r.value); return s; }
function zip(a, b) { const pairs = []; for (let n = 0; n < 6; n++) { const p = a.next(), q = b.next(); if (p.done || q.done) break; pairs.push([p.value, q.value]); } return pairs; }
function take(it, n) { const taken = []; let r = it.next(); while (!r.done && taken.length < n) { taken.push(r.value); r = it.next(); } return taken; }
function f0(x) { const one = { value: 3, done: false }; const later = []; let total = 0; const it = set.entries(); let n = 0; let r = it.next(); outer: while (!r.done && n++ < 9) { const first = r.value; let same = 0; while (!r.done && n++ < 30) { if (r.value !== first) continue outer; same++;  if (r == null) log("none"); if (n > 5) break; r = it.next(); } log(first, same); } log(total, later.length); return total; }
function run0() { let s = 0; for (let k = 0; k < 40; k++) { try { s += f0(k % 6); } catch (error) { log(error.name, error.message); } } return s; }
log(run0());
function f1(x) { const one = { value: 3, done: false }; const later = []; let total = 0; try { const it = map.values(); let n = 0; let r = it.next(); outer: while (!r.done && n++ < 9) { const first = r.value; let same = 0; while (!r.done && n++ < 30) { if (r.value !== first) continue outer; same++; total += Number(r.value) || 1; if (saved === r) log("same"); total += (r ?? one).value === 3 ? 2 : 1; r = it.next(); } log(first, same); } } catch (error) { log(error.name, error.message); } log(total, state, later.map(g => g())); return total; }
for (let k = 0; k < 12; k++) f1(k % 5);
function f2(x) { const one = { value: 3, done: false }; const later = []; let total = 0; const it = talk(x & 3); let n = 0; let r; while (n++ < 9 && !(r = it.next(n)).done) { if (n === 2) { set.add(x + 20); } total += Number(r.value) || 1; } log(r.value); log(total, later.length); return total; }
function run2() { let s = 0; for (let k = 0; k < 40; k++) { try { s += f2(k % 6); } catch (error) { log(error.name, error.message); } } return s; }
log(run2());
for (const line of out) console.log(line);
console.log(state, show(kept.slice(0, 20)), show(saved));
