// Recursion down to zero by logical operators and negations: counts, fractions, other values, both orders, nested negations, values of the operators.
const out = [];
const even = n => n === 0 || odd(n - 1), odd = n => n !== 0 && even(n - 1);
const down = n => !(n === 0) && down(n - 1) || n;
const twice = n => !!(n !== 0) ? twice(n - 1) + 1 : 0;
const back = n => 0 === n || (n > 0 ? back(n - 1) : back(n + 1));
const masked = k => { const m = k & 7; return m !== 0 && 64 / (m - 1 + 1) || m === 0 || -1; };
const last = (l, i) => i !== 0 && last(l, i - 1) || l[i];
function ends(list) { let i = list.length; return i !== 0 && list[i - 1] !== undefined || i; }
for (const n of [0, 1, 2, 7, 30, 1000]) out.push(even(n), odd(n), down(n), twice(n), back(n), back(-n));
for (let k = -9; k < 18; k++) out.push(masked(k));
out.push(last([1, 0, 3], 2), last(["", 0, null], 2), ends([]), ends([4]), ends([undefined]));
const stop = n => n === 0 || n < -3 || stop(n - 1);
for (const n of [0.5, -0, -1, 2.25, "3", null, true]) out.push(stop(n));
let t = 0; for (let k = 0; k < 2000; k++) t += (even(k & 31) ? 1 : 0) + (odd(k & 15) ? 2 : 0); out.push(t);
console.log(out.join(" "));
