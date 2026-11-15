// One bit decides whether a number is combined with a constant by exclusive or: check sums, shift registers, doublings in fields, and the forms beside them.
// STATISTIC: XorsUnderBitsFolded >= 6
const show = v => Object.is(v, -0) ? "-0" : String(v);
function crc(c) { for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; }
function ccitt(c) { for (let k = 0; k < 16; k++) c = c & 0x8000 ? (c << 1 ^ 0x1021) & 0xffff : c << 1 & 0xffff; return c; }
function twice(x) { return x & 0x80 ? x << 1 ^ 0x11b : x << 1; }
function sign(x) { return x & 0x80000000 ? x ^ 0x55 : x; }
function register(x) { return x & 1 ? x >> 1 ^ -0x2d0 : x >> 1; }
function turned(x) { return x & 4 ? x : x ^ 9; }
function other(x, y) { return x & 2 ? y ^ 3 : y; }
function several(x) { return x & 6 ? x ^ 5 : x; }
function same(x) { return x & 8 ? x ^ 0 : x; }
let calls = 0;
function counted(x) { let z; if (x & 16) { z = x << 2 ^ 77; calls++; } else z = x << 2; return z; }
function local(x) { let z = x << 3; if (x & 32) z ^= 0x7001; return z; }
const table = []; for (let i = 0; i < 256; i++) table[i] = crc(i);
console.log(table.join(" "));
let all = 0;
for (const v of [0, 1, 2, 3, 5, 15, 127, 128, 129, 255, 256, 65535, 0x7fffffff, -0x80000000, -1, -128, 4294967295, 1.5, -0, NaN, Infinity, "130", "x", true, null, undefined, [129], { valueOf() { calls++; return 255; } }]) {
  const told = [crc, ccitt, twice, sign, register, turned, several, same, counted, local].map(f => { try { return show(f(v)); } catch (e) { return e.name; } }).join(" ") + " " + show(other(v, 12)) + " " + show(other(7, v)) + " " + calls;
  for (let i = 0; i < told.length; i++) all = Math.imul(all, 31) + told.charCodeAt(i) | 0;
  console.log(told);
}
function rows(s) { for (var c = 0; c < 4; c++) { var b = new Array(4); for (var i = 0; i < 4; i++) b[i] = s[i][c] & 0x80 ? s[i][c] << 1 ^ 0x11b : s[i][c] << 1; s[0][c] = b[0] ^ b[1]; s[1][c] = b[2]; s[2][c] = b[3] & 255; s[3][c] = b[1] & 255; } return s; }
const s = [[], [], [], []]; for (let i = 0; i < 16; i++) s[i & 3][i >> 2] = i * 37 & 255;
for (let k = 0; k < 9; k++) rows(s);
console.log(s.join(" | "), all);
