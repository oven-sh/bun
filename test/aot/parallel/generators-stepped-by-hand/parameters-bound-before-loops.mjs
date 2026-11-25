// What a loop does before its first step follows the binding of the generator's parameters: defaults, patterns, getters, errors.
const log = [];
function note(v) { log.push(v); return v; }
function* range(a, b, step = note(1)) { for (let k = a; k < b; k += step) yield k; }
function* members({ a, b = note("b") }) { const got = yield a; log.push(got); yield b; return "end"; }
function* firsts([a, b = note(a)]) { try { yield a; yield b; } finally { log.push("closed"); } }
function* none(a, b = note("none")) { log.push("body"); }
let limit = 3;
function* moves(list = note("list") && [1, 2, 3], n = (limit += 1)) { for (const v of list) { limit++; yield v + n; } }
function counted(n) { let t = 0, k = 0; const it = range(0, 9); while (k < n) { note("k" + k); const r = it.next(); if (r.done) break; t += r.value; k++; } return t; }
function left(n) { let t = 0; const it = range(0, 4); for (;;) { if (log.length > n) return "left " + t; const { value, done } = it.next(); if (done) return t; t += value; log.push(0); } }
function sent(o) { let t = "", k = 0; const it = members(o); while (k < 5) { const r = it.next(note("s" + k)); if (r.done) { t += r.value; break; } t += r.value; k++; } return t; }
function pairs(o, n) { let t = 0, k = 0; const it = firsts(o); let r; while (k < n && !(r = it.next()).done) { t += r.value; k++; } return t; }
function empty(n) { let t = 0, k = 0; const it = none(1); while (k < n) { const r = it.next(); if (r.done) { t = 7; break; } k++; } return t; }
function until() { let t = 0; const it = moves(); let k = 0; while (k < limit) { const r = it.next(); if (r.done) break; t += r.value; k += 2; } return t; }
function outer(n) { let t = 0; rows: for (let i = 0; i < n; i++) { const it = range(i, 6); let k = 0; while (k < 3) { if (i === 2 && k === 1) continue rows; const r = it.next(); if (r.done) break; if (r.value === 4) break rows; t += r.value; k++; } } return t; }
function throws(v) { let t = 0, k = 0; try { const it = members(v); while (k < 2) { const r = it.next(); if (r.done) break; t++; k++; } } catch (error) { t = error.name; } return t; }
const got = [];
const tell = (f, ...args) => { let v; try { v = f(...args); } catch (error) { v = error.name; } got.push(f.name + " " + v + " [" + log.splice(0).join() + "]"); };
for (let turn = 0; turn < 3; turn++) {
    for (const n of [0, 1, 2, 5, 12]) { tell(counted, n); tell(left, n); tell(empty, n); tell(outer, n); }
    for (const o of [{ a: 1 }, { a: 1, b: 2 }, { get a() { return note("get"); } }, null, undefined]) { tell(sent, o); tell(throws, o); }
    for (const o of [[1], [1, 2], [], null, "xy"]) { tell(pairs, o, 1); tell(pairs, o, 9); tell(pairs, o, 0); }
    limit = 3; tell(until); tell(until);
}
let sum = 0;
for (let i = 0; i < 300; i++) { sum += counted(i % 5) + outer(i % 4); log.length = 0; }
console.log(got.join("\n") + "\n" + sum);
