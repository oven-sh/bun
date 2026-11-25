// Sums and differences of a number and a written integer that only a comparison reads: bounds of int32 and of 2 ** 53, recursion that steps down, chains of steps.
const out = [];
function even(n) { return n === 0 ? true : odd(n - 1); } function odd(n) { return n === 0 ? false : even(n - 1); }
for (let k = 0; k < 40; k++) out.push(even(k) ? 1 : 0, odd(k) ? 1 : 0);
const third = n => n === 0 ? "a" : n - 1 === 0 ? "b" : n - 2 === 0 ? "c" : third(n - 3);
for (let k = 0; k < 20; k++) out.push(third(k));
function steps(x) { let s = 0; if ((x & 15) + 1 === 4) s += 1; if ((x & 15) - 7 !== 2) s += 2; if ((x | 0) + 1 === -2147483647) s += 4; if ((x | 0) - 1 === 2147483646) s += 8; if (((x | 0) + 1 | 0) === -2147483648) s += 16; if (((x | 0) - 1 | 0) === 2147483647) s += 32; if ((x >>> 0) + 1 === 4294967296) s += 64; return s; }
for (const x of [0, 3, 9, -1, 7, 2147483647, -2147483648, 2147483646, -2147483647, 4294967295, 1.5, -0, NaN]) out.push(steps(x));
function count(n) { let t = 0; for (let k = n; k - 3 !== 0; k--) t += k; return t; }
for (let k = 3; k < 12; k++) out.push(count(k));
function far(n) { let t = 0; for (let k = 0; k < 9; k++) if (n + k === 9007199254740992) t += 1 << k; return t; }
for (const n of [9007199254740984, 9007199254740988, 9007199254740992, 5, 0.5]) out.push(far(n));
function last(text) { for (let k = 0; k < text.length; k++) if (k + 1 === text.length) return text[k]; return ""; }
out.push(last("abc"), last(""), last("x"));
function both(n) { const m = n - 1; if (m === 0) return "one"; if (m === 4) return m; return m + 1; }
for (let k = -2; k < 8; k++) out.push(both(k));
console.log(out.join());
