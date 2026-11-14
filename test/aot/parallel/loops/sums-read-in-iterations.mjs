// STATISTIC: UnrolledLoopIntegerSums >= 2
// Numbers that iterations count or add integers to and also read: before and after the addition, as bits, as doubles, in comparisons and in arms; minus zero, fractions and 2 ** 53 at the start.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const starts = [0, -0, 5, 0.5, 2 ** 31 - 5, 2 ** 52 - 3, 2 ** 53 - 9, 2 ** 53, -(2 ** 53) + 5, NaN, Infinity];
const counts = [0, 1, 7, 8, 9, 100, 5000];
const out = [];
const counter = { value: 0, next() { return ++this.value; }, back(x) { return this.value -= x; } };
function bits(n, turns) { counter.value = n; let t = 0; for (let k = 0; k < turns; k++) t += counter.next() & 7; return show(counter.value) + " " + t; }
function halves(n, turns) { counter.value = n; let t = 0; for (let k = 0; k < turns; k++) t += counter.back(k & 3) / 2; return show(counter.value) + " " + show(t); }
function before(n, turns) { let t = 0; for (let k = 0; k < turns; k++) { t += n % 10; n += k & 7; } return show(n) + " " + show(t); }
function largest(n, turns) { let m = -Infinity; for (let k = 0; k < turns; k++) { n += (k & 3) - 1; if (n > m) m = n; } return show(n) + " " + show(m); }
function left(n, turns, stop) { for (let k = 0; k < turns; k++) { n += 3; if (n === stop) break; n--; } return show(n); }
function signs(n, turns) { let t = ""; for (let k = 0; k < turns && k < 9; k++) { t += 1 / n > 0 ? "+" : "-"; n += 0; } return t; }
for (const n of starts)
    for (const turns of counts)
        out.push(bits(n, turns), halves(n, turns), before(n, turns), largest(n, turns), left(n, turns, n + 25), signs(n, turns));
let sum = 0;
for (const text of out) for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) % 1000003;
console.log(out.length, sum);
console.log(out.slice(0, 84).join(), out.slice(-24).join());
