// md5_ff(a, b, c, d, x[i + 1], ..): a large loop passes the elements of one array to functions that compute numbers, and gets a version.
// STATISTIC: LargeLoopsOfElementsVersioned >= 1
function add(x, y) { var l = (x & 0xffff) + (y & 0xffff), m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xffff); }
function rotate(n, c) { return (n << c) | (n >>> (32 - c)); }
function step(q, a, b, x, s, t) { return add(rotate(add(add(a, q), add(x, t)), s), b); }
function ff(a, b, c, d, x, s, t) { return step((b & c) | (~b & d), a, b, x, s, t); }
function gg(a, b, c, d, x, s, t) { return step((b & d) | (c & ~d), a, b, x, s, t); }
function hh(a, b, c, d, x, s, t) { return step(b ^ c ^ d, a, b, x, s, t); }
function digest(x) {
  var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (var i = 0; i < x.length; i += 16) {
    var a0 = a, b0 = b;
    a = ff(a, b, c, d, x[i + 0], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i + 0], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = add(a, a0); b = add(b, b0);
  }
  return [a, b, c, d];
}
function packed(s) { var bin = Array(); for (var i = 0; i < s.length * 8; i += 8) bin[i >> 5] |= (s.charCodeAt(i / 8) & 255) << (i % 32); return bin; }
function hash(s) { var x = packed(s), length = s.length * 8; x[length >> 5] |= 0x80 << (length % 32); x[(((length + 64) >>> 9) << 4) + 14] = length; return digest(x); }
var text = "";
for (var i = 0; i < 400; i++) text += String.fromCharCode(33 + (i * 7) % 190);
for (var n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 200, 400]) console.log(n, hash(text.slice(0, n)).join());
var all = 0;
for (var n = 0; n < 200; n++) { var h = hash(text.slice(n)); all = Math.imul(all, 31) + h[0] + h[3] | 0; }
console.log(all);
for (var x of [[1, 2, , 4], [0.5, 1e10, -0, NaN], ["5", null, true, undefined], [{ valueOf() { return 3; } }], Object.freeze([7, 8]), new Int32Array(20).fill(-9), { length: 17, 3: 5 }]) console.log(digest(x).join());
try { digest([1n]); } catch (e) { console.log(e.name); }
