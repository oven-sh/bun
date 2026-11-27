// Products by the factors of hashes and digits: 32 bits that wrap, integers beyond 32 bits, doubles, -0, in loops and out of them.
const numbers = [0, -0, 1, -1, 2, 7, 10, 255, 46340, 65535, 65536, 69273666, 138547332, 214748364, 214748365, 429496729, 715827882, 715827883, 2147483647, -2147483648, 4294967295, 4294967296, 1e15, 9007199254740991, 0.5, -2.75, NaN, Infinity];
const show = v => Object.is(v, -0) ? "-0" : String(v);
function imul(n) { return [Math.imul(n, 3), Math.imul(n, 5), Math.imul(n, 9), Math.imul(n, 10), Math.imul(n, 31), Math.imul(n, 33), Math.imul(31, n), Math.imul(n, -31)].join(); }
function wrapped(n) { n |= 0; return [n * 3 | 0, n * 5 | 0, n * 9 | 0, n * 10 | 0, n * 31 | 0, n * 33 | 0, 10 * n | 0, n * 31 >>> 0, n * 33 >>> 1].join(); }
function exact(n) { return [n * 3, n * 5, n * 9, n * 10, n * 31, n * 33, 33 * n].map(show).join(); }
for (const n of numbers) console.log(imul(n), wrapped(n), exact(n));
function hash31(t) { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return h >>> 0; }
function hash33(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = (h * 33 ^ t.charCodeAt(i)) | 0; return h; }
function hashExact(t) { let h = 7; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 1000003; return h; }
function digits(t) { let n = 0; for (let i = 0; i < t.length; i++) n = n * 10 + t.charCodeAt(i) - 48; return n; }
function digits32(t) { let n = 0; for (let i = 0; i < t.length; i++) n = (n * 10 + (t.charCodeAt(i) - 48)) | 0; return n; }
for (const t of ["", "a", "alpha", "The Quick Brown Fox", "é中\u{1F600}", "0123456789", "99999999999999999999", "x".repeat(300)]) console.log(hash31(t), hash33(t), hashExact(t), digits(t), digits32(t));
function rows(list, w) { let s = 0; for (let i = 0; i < list.length; i++) s += list[(i * 3 + w * 5) % list.length] * 9 + i * 10; return s; } console.log(rows([1, 2, 3, 4, 5, 6, 7], 3), rows([0.5, 1.5], 1), rows([2147483647, 2], 1));
function walk(n) { let a = 1, b = 1, c = 1, d = 1; const out = []; for (let i = 0; i < n; i++) { a = a * 3; b = b * 5 | 0; c = Math.imul(c, 9) + i; d = d * 33 & 0xffff; out.push(a, b, c, d, i * 31 - i * 10); } return out.join(); } console.log(walk(45));
const wide = []; for (let i = 0; i < 60; i++) wide.push(BigInt.asIntN(64, (1n << BigInt(i)) * 31n) + "," + (2 ** i) * 31 + "," + (2 ** i) * 33 + "," + (2 ** i + 1) * 10); console.log(wide.join(" "));
