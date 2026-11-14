// STATISTIC: UnrolledLoopIntegerSums >= 1
// Iterations that count a number up or down by one, alone and beside additions, in fields and captured variables: minus zero, fractions and 2 ** 53 at the start, breaks and throws.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const starts = [0, -0, 5, 0.5, 2 ** 52 - 3, 2 ** 53 - 9, 2 ** 53, -(2 ** 53) + 5, NaN, Infinity];
const counts = [0, 1, 7, 8, 9, 100, 5000];
const out = [];
const state = { count: 0, total: 0 };
function fields(n, turns) { state.count = n; state.total = n; for (let k = 0; k < turns; k++) { state.count++; state.total += k & 3; } return show(state.count) + " " + show(state.total); }
class Store { constructor() { this.up = 0; this.down = 0; } step() { this.up++; this.down--; } }
const store = new Store();
function methods(n, turns) { store.up = n; store.down = n; for (let k = 0; k < turns; k++) store.step(); return show(store.up) + " " + show(store.down); }
function closure(n) { let c = n; return { step(x) { c++; c -= x; }, get: () => c }; }
function captured(n, turns) { const c = closure(n); for (let k = 0; k < turns; k++) c.step(k & 1); return show(c.get()); }
function local(n, turns) { for (let k = 0; k < turns; k++) { n--; n += 2; n--; n++; } return show(n); }
function left(n, turns) { for (let k = 0; k < turns; k++) { n++; if (k === 13) break; n++; } return show(n); }
function thrown(n, turns) { state.count = n; try { for (let k = 0; k < turns; k++) { state.count++; if (k === 13) throw 0; } } catch { } return show(state.count); }
for (const n of starts)
    for (const turns of counts)
        out.push(fields(n, turns), methods(n, turns), captured(n, turns), local(n, turns), left(n, turns), thrown(n, turns));
let sum = 0;
for (const text of out) for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) % 1000003;
console.log(out.length, sum);
console.log(out.slice(0, 48).join(), out.slice(-24).join());
