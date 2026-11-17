// Loops and recursion whose numbers fall toward zero: remainders by divisors that a test has shown not to be zero, and by divisors that nothing shows; digits, halves, shifts, differences.
const show = x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x);
function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a; }
function tested(a, b) { while (b !== 0) { const t = a % b; a = b; b = t; } return a; }
function positive(a, b) { while (b > 0) { const t = a % b; a = b; b = t; } return a; }
function recursive(a, b) { return b === 0 ? a : recursive(b, a % b); }
function falsy(a, b) { return !b ? a : falsy(b, a % b); }
function untested(a, b) { let s = 0; for (let i = 0; i < 9; i++) { s += a % b; b = b - 1; } return s; }
function late(a, b) { let t = 0; for (let i = 0; i < 9; i++) { if (b !== 0) t = t + a % b; b = b - 1; t = t + a % b; } return t; }
function other(a, b, c) { let t = 1, g = 0; while (b && g++ < 40) { t = t + a % c; b = b - 1; c = c - 1; } return t; }
function digits(a, b) { let s = 0; while (a > 0 && s < 1e6) { s = s * 3 + a % 10; a = Math.floor(a / 10); } return s + b; }
function bits(a, b) { let n = 0; while (a && n < 64) { n += a & 1; a >>>= 1; } return n * b; }
function halves(a, b) { let lo = 0, hi = a, g = 0; while (lo < hi && g++ < 70) { const m = lo + hi >> 1; if (m >= b) hi = m; else lo = m + 1; } return lo; }
function differences(a, b) { let g = 0; while (a !== b && g++ < 90) if (a > b) a = a - b; else b = b - a; return a; }
function below(a, b) { let n = 0, g = 0; for (let i = a; i >= b - 3; i--) { n = (n * 2 + i) % 1009; if (g++ > 40) break; } return n; }
function signed(a, b) { let t = 0; while (b && t < 30) { t++; const r = a % b; if (Object.is(r, -0)) t += 100; a = b; b = r; } return t + a; }
function untestedIntegers(a, b) { let s = 0; for (let i = 0; i < 9; i++) { s += a % b; b = b - 1; } return s; }
function lateIntegers(a, b) { let t = 0; for (let i = 0; i < 9; i++) { if (b !== 0) t = t + a % b; b = b - 1; t = t + a % b; } return t; }
function otherIntegers(a, b, c) { let t = 1; for (let i = 0; i < 9; i++) { if (b) t = t + a % c; b = b - 1; c = c - 1; } return t; }
function shownElsewhere(a, b) { let t = 0; for (let i = 0; i < 9; i++) { const c = b - i; if (c === 0) t = t + 1; if (i & 1) t = t + a % c; } return t; }
const all = { gcd, tested, positive, recursive, falsy, untested, late, digits, bits, halves, differences, below, signed, other: (a, b) => other(a, b, 5) };
let sum = 0;
for (let i = 1; i < 60; i++) for (let k = 1; k < 40; k++) sum = (sum * 3 + gcd(i, k) + tested(i, k) + recursive(i, k) + falsy(i, k) + positive(i, k) + digits(i, k) + bits(i, k) + halves(i, k) + differences(i, k) + below(i % 20, k % 7) + signed(i, k)) % 1000003;
console.log(sum); let late2 = 0; for (let i = 0; i < 30; i++) for (let k = -3; k < 9; k++) late2 += show(untestedIntegers(i, k)).length + show(lateIntegers(i, k)).length * 3 + show(otherIntegers(i, k, k)).length * 5 + show(shownElsewhere(i, k)).length * 7; console.log(late2);
const few = [[12, 18], [0, 5], [5, 0], [0, 0], [-12, 18], [12, -18], [-12, -18], [-0, 3], [3, -0], [2 ** 31, 6], [2 ** 31 - 1, -(2 ** 31)], [-(2 ** 31), -1], [2 ** 53, 3], [2 ** 53 - 1, 2 ** 31 + 1], [2 ** 60, 2 ** 40], [1.5, .5], [7.25, 2], [NaN, 3], [3, NaN], [Infinity, 4], [4, Infinity], [-Infinity, 2], ["18", "12"], ["x", 3], [undefined, 4], [4, undefined], [null, 5], [true, 2], [18n, 12n], [0n, 5n], [5n, 0n], [4294967295, 65536], [1e300, 7], [5e-324, 3]];
for (const name of Object.keys(all)) for (const [a, b] of few) { let r; if ((name === "tested" || name === "recursive") && typeof a !== "bigint" && !(Number.isFinite(a) && Number.isFinite(b))) continue; try { r = show(all[name](a, b)); } catch (e) { r = e.constructor.name; } console.log(name, show(a), show(b), r); }
