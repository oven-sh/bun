// Numbers of loops whose bits are taken and that are multiplied, added to and halved without a sign: within int32, past it, past uint32 and past 2 ** 53, from every kind of start.
function collatz(n) { let c = 0, top = n; while (n !== 1 && c < 600) { n = n & 1 ? 3 * n + 1 : n >>> 1; c++; if (n > top) top = n; } return c + "|" + top; }
function five(n) { let c = 0; while (n > 0 && c < 90) { n = n & 1 ? 5 * n - 3 : n >>> 2; c++; } return c + "|" + n; }
function mixed(n) { let c = 0; while (c < 80) { if (n & 4) n = n * 7 + 5; else if (n & 2) n = n >>> 3; else n = (n >>> 1) + 11; c++; } return n; }
function negative(n) { let c = 0; while (c < 60) { n = n & 1 ? -3 * n + 1 : n >>> 1; c++; } return n; }
function whole(n) { let c = 0; while (c < 60) { n = n & 1 ? 3 * n + 1 : n >>> 0; c++; if (c & 1) n = n - 1; } return n; }
function wide(n) { let c = 0; while (c < 60) { n = n & 1 ? 3 * n + 1 : n >>> 32; c++; n = n + 3; } return n; }
function variable(n, k) { let c = 0; while (c < 60) { n = n & 1 ? 3 * n + 1 : n >>> k; c++; n = n + (c & 1); } return n; }
function digits(n) { let s = 0, c = 0; while (n !== 0 && c < 60) { s = s * 31 + (n & 15); n = n >>> 4; c++; } return s; }
function joined(n, m) { let c = 0; while (c < 70) { const t = n & 8 ? m >>> 1 : n * 3 + 1; m = m & 1 ? n >>> 5 : m * 5 - 2; n = t; c++; } return n + "|" + m; }
const show = x => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x);
let all = 0; for (let i = 1; i < 400; i++) all = all * 3 + collatz(i).length + five(i).length + show(mixed(i)).length + show(negative(i)).length + show(whole(i)).length + show(wide(i)).length + show(variable(i, i % 5)).length + show(digits(i)).length + joined(i, i + 7).length | 0;
console.log(all);
const few = [0, 1, 27, 97, 871, 113383, 837799, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 33 + 5, 2 ** 53 - 1, 2 ** 53, 1e20, -1, -27, -(2 ** 31), -(2 ** 31) - 1, 1.5, -2.5, .1, -0, NaN, Infinity, -Infinity];
for (const n of few) for (const f of [collatz, five, mixed, negative, whole, wide, digits]) console.log(f.name, show(n), show(f(n)));
for (const n of few) { for (const k of [0, 1, 5, 31, 32, 33]) console.log("variable", show(n), k, show(variable(n, k))); console.log("joined", show(n), joined(n, 9), joined(4, n)); }
for (const n of ["27", undefined, null, true, 27n, { valueOf: () => 27 }, [9]]) for (const f of [x => collatz(x), x => digits(x), x => mixed(x)]) { let r; try { r = show(f(n)); } catch (e) { r = e.constructor.name; } console.log(typeof n, r); }
