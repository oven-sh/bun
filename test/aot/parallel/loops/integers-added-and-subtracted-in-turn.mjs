// STATISTIC: UnrolledLoopIntegerSums >= 3
// Iterations that add and subtract several integers one after another, in a local, a field, a captured variable and a variable of the file: minus zero, fractions and 2 ** 53 at the start, breaks, throws and
// other numbers among the terms.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const starts = [0, -0, 5, 0.5, 2 ** 51, 2 ** 52 - 3, 2 ** 53 - 9, -(2 ** 53) + 5, NaN, Infinity, 2 ** 32];
const counts = [0, 1, 7, 8, 9, 100, 5000];
const out = [];
function local(n, turns) { for (let k = 0; k < turns; k++) n = n + (k & 7) - (k & 3) + 1; return n; }
function difference(n, turns) { for (let k = 0; k < turns; k++) n -= k & 3; return n; }
function nothing(n, turns, zero) { for (let k = 0; k < turns; k++) { n -= zero & k; n -= 0; } return n; }
class Total { constructor() { this.n = 0; this.add = x => { this.n += x; return this; }; } take(x) { this.n -= x; return this; } }
const total = new Total();
function field(n, turns) { total.n = n; for (let k = 0; k < turns; k++) total.add(k & 3).add(1); return total.n; }
function method(n, turns) { total.n = n; for (let k = 0; k < turns; k++) total.take(k & 3).take(k).take(2); return total.n; }
let shared = 0;
function file(n, turns) { shared = n; for (let k = 0; k < turns; k++) { shared += k; shared -= 3; } return shared; }
function left(n, turns, stop) { for (let k = 0; k < turns; k++) { n += k & 7; if (k === stop) break; n -= 3; } return n; }
const last = { n: 0 };
function thrown(n, turns, stop) { last.n = n; try { for (let k = 0; k < turns; k++) { last.n += k; if (k === stop) throw 0; last.n -= 2; } } catch { } return last.n; }
function elements(n, turns, list) { for (let k = 0; k < turns; k++) { n += list[k & 3]; n -= list[k & 1]; } return n; }
for (const n of starts) {
    for (const turns of counts) {
        out.push(show(local(n, turns)), show(difference(n, turns)), show(nothing(n, turns, 0)), show(field(n, turns)), show(method(n, turns)), show(file(n, turns)), show(left(n, turns, 13)), show(thrown(n, turns, 13)));
        out.push(show(elements(n, turns, [1, 2, 3, 4])), show(elements(n, turns, [1, -0, 2.5, 4])), show(elements(n, turns, [1, , 3, 2147483647])));
    }
}
let sum = 0;
for (const text of out) for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) % 1000003;
console.log(out.length, sum);
console.log(out.slice(0, 44).join(), out.slice(-44).join());
