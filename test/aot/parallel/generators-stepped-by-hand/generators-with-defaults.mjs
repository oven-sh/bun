// Defaults that are constants or other parameters are bound unseen: such generators are passed on, stepped in rows and by hand like others. Defaults that run code are not.
let calls = 0;
function* range(a, b = a + 3, step = 1) { for (let k = a; k < b; k += step) yield k; }
function* steps(a, n = 4, by = 2, name = "s") { for (let k = 0; k < n; k++) yield name + (a + k * by); }
function* same(a, b = a) { yield a; yield b; return [a, b]; }
function* noted(a, b = (calls++, 2)) { for (let k = a; k < b + a; k++) yield k; }
function* flagged(a, on = true, off = null, u = undefined) { if (on) yield a; if (off === null) yield u; yield off ?? a; }
function* map(it, f = v => v) { for (const v of it) yield f(v); }
function* filter(it, f, n = 9) { for (const v of it) { if (n-- <= 0) return; if (f(v)) yield v; } }
function sum(it) { let t = 0; for (const v of it) t += v; return t; }
function drive(it, n = 3) { const all = []; for (let k = 0; k < n; k++) { const r = it.next(k); if (r.done) break; all.push(r.value); } return all; }
function passed(x) { return [sum(range(x, x + 4)), sum(range(x, x + 4, 2)), sum(range(x, undefined)), sum(noted(x)), calls]; }
function pipelines(x) { const all = []; for (const v of map(filter(range(x, x + 6), v => v & 1), v => v * 2)) all.push(v); for (const v of map(steps(x, 2))) all.push(v); return all; }
function driven(x) { return [drive(range(x, x + 9)), drive(steps(x), 2), drive(flagged(x)), drive(same(x), 0), drive(noted(x), 0), calls]; }
function rows(x) { const all = []; for (let z = 0; z < 2; z++) { const it = same(x); const a = it.next(); const b = it.next(); const c = it.next(); all.push(a.value, b.value, c.value, c.done); const other = flagged(x, z); all.push(other.next().value, other.next().value); } return all; }
function fronts(x) { const all = []; const it = range(x, x + 5); all.push("front"); let k = 0; while (k < 3) { all.push(k++); const r = it.next(); if (r.done) break; all.push(r.value); } const other = noted(x); all.push(calls); let r; while (!(r = other.next()).done && all.length < 12) all.push(r.value); return all; }
function none(x) { for (let z = 0; z < 3; z++) { range(x); noted(x); const it = steps(x); } return calls; }
function taken(x) { const all = []; for (let z = 0; z < 2; z++) { const [a, b] = steps(x); const [c, ...d] = range(x, x + 3); all.push(a, b, c, d.length, [...same(x)].length, Array.from(flagged(x)).length, Math.max(...range(x, x + 2))); } return all; }
const out = [];
for (let turn = 0; turn < 3; turn++) {
    for (const f of [passed, pipelines, driven, rows, fronts, none, taken]) {
        for (const x of [0, 1, 5, 2.5, undefined]) {
            try { out.push(f.name + " " + String(x) + " " + JSON.stringify(f(x))); } catch (error) { out.push(f.name + " " + error.name); }
        }
    }
}
let total = 0;
for (let k = 0; k < 400; k++) total += sum(range(k & 7, (k & 7) + 4)) + pipelines(k & 3).length + rows(k & 1).length;
console.log(out.join("\n") + "\n" + total + " " + calls);
