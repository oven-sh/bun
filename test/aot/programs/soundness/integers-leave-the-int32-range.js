// Integer proofs: overflow, -0, NaN, shifts, division, loop counters, array indexes.
function mul(a, b) { return a * b; }
let r = []; for (let i = 65535; i < 65538; i++) r.push(mul(i, i)); console.log(r.join());
let x = 2147483646; for (let i = 0; i < 3; i++) x++; console.log(x, x | 0);
let y = -2147483647; for (let i = 0; i < 3; i++) y--; console.log(y);
console.log(Object.is(mul(0, -1), -0), Object.is(-0 + 0, 0), Object.is(Math.round(-0.2), -0), Object.is(0 / -3, -0), 1 / (0 * -1));
function idx(a, i) { return a[i]; }
const arr = [10, 20, 30]; console.log(idx(arr, 1), idx(arr, -1), idx(arr, 3), idx(arr, 1.5), idx(arr, "1"), idx(arr, 4294967295), idx(arr, NaN));
console.log(5 % -5, Object.is(-5 % 5, -0), 5 / 2 | 0, (-5) >>> 0, 1 << 31, 1 << 32, 2 ** 31 >> 0, -1 >>> 31);
function half(n) { return n / 2; } let hs = 0; for (let i = 0; i < 5; i++) hs += half(i); console.log(hs);
function abs(n) { return Math.abs(n); } console.log(abs(-2147483648), abs(-2147483648 | 0), -(-2147483648 | 0), Math.imul(65536, 65536), Math.max(), Math.min(0, -0));
let c = 0; for (let i = 0; i < 10; i += 0.5) c++; console.log(c);
let big = 1; for (let i = 0; i < 40; i++) big *= 2; console.log(big, big | 0);
let sum = 0; for (let i = 0; i < 100000; i++) sum += i * 100000; console.log(sum);
const len = "abc".length - 4; console.log(len, "abc".charCodeAt(len), "abc"[len], "abc".at(len + 3));
console.log(parseInt("9007199254740993"), Number.MAX_SAFE_INTEGER + 2, 0.1 + 0.2, (0.1 * 3) | 0, ~~2147483648.5, Math.floor(-0.5), Math.trunc(-0.5));
function count(n) { let k = 0; while (n) { n &= n - 1; k++; } return k; } console.log(count(-1), count(2 ** 32), count(2 ** 31));
let u = 4294967295; u = u + 1; console.log(u, u >>> 0); let neg = 0; neg = -neg; console.log(Object.is(neg, -0));
const ta = new Int8Array(2); ta[0] = 200; ta[1] = -129.7; console.log(ta[0], ta[1], ta[2], ta[-1]);
