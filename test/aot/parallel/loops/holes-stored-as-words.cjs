// w[j] = x[i + j], where only bits of the elements of w are read: a hole of x is stored as zero in the version of the loop.
// STATISTIC: HolesStoredAsZero >= 1
function rotate(n, count) { return (n << count) | (n >>> (32 - count)); }
function add(a, b) { return ((a & 0xffffffff) + (b & 0xffffffff)) & 0xffffffff; }
function late(a, b = 9) { return add(a, b); }
function counted(a) { return (a & 3) + String(arguments[0]).length; }
function packed(s) { var words = Array(); for (var i = 0; i < s.length * 8; i += 8) words[i >> 5] |= (s.charCodeAt(i / 8) & 255) << (24 - i % 32); return words; }
function digest(x, length) {
  x[length >> 5] |= 0x80 << (24 - length % 32);
  x[((length + 64 >> 9) << 4) + 15] = length;
  var w = Array(80), a = 1732584193, b = -271733879, c = 271733878;
  for (var i = 0; i < x.length; i += 16) {
    var first = a;
    for (var j = 0; j < 80; j++) {
      if (j < 16) w[j] = x[i + j];
      else w[j] = rotate(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      var t = add(add(rotate(a, 5), b ^ c), add(c, w[j]));
      c = rotate(b, 30); b = a; a = t;
    }
    a = add(a, first);
  }
  return [a, b, c];
}
function kept(x) { var w = Array(16), s = 0; for (var i = 0; i < x.length; i += 16) for (var j = 0; j < 16; j++) { w[j] = x[i + j]; s = (s + (w[j] & 255)) | 0; } return [s, w]; }
function compared(x) { var w = Array(16), s = 0; for (var i = 0; i < x.length; i += 16) for (var j = 0; j < 16; j++) { w[j] = x[i + j]; s ^= w[j]; if (w[j] === undefined) s += 1000; } return [s]; }
function defaulted(x) { var w = Array(16), s = 0; for (var i = 0; i < x.length; i += 16) for (var j = 0; j < 16; j++) { w[j] = x[i + j]; s = late(s, w[j]); } return [s]; }
function seen(x) { var w = Array(16), s = 0; for (var i = 0; i < x.length; i += 16) for (var j = 0; j < 16; j++) { w[j] = x[i + j]; s = counted(w[j]) + s; } return [s]; }
function bits(x) { var w = Array(16), s = 0; for (var i = 0; i < x.length; i += 16) for (var j = 0; j < 16; j++) { w[j] = x[i + j]; s = add(s, w[j]) ^ ~w[j]; } return [s]; }
function given(n, holes) { var x = []; for (var i = 0; i < n; i++) x[i] = Math.imul(i + 1, 0x9e3779b1); for (var h of holes) if (h < n) delete x[h]; return x; }
var text = "";
for (var i = 0; i < 300; i++) text += String.fromCharCode(33 + (i * 7) % 190);
for (var n of [0, 1, 50, 55, 56, 64, 119, 300]) console.log("digest", n, JSON.stringify(digest(packed(text.slice(0, n)), n * 8)));
var long = given(40, []); long[63] = 4;
var inputs = [given(0, []), given(16, []), given(64, [5, 6, 63]), given(48, [0]), [1, 2, , 4], [0.5, 1e10, , NaN], [undefined, null, true, "7"], long];
for (var f of [kept, compared, defaulted, seen, bits]) for (var x of inputs) { try { console.log(f.name, JSON.stringify(f(x)), JSON.stringify(f(x))); } catch (e) { console.log(f.name, e.name); } }
var all = 0;
for (var n = 0; n < 60; n++) { var d = digest(packed(text.slice(n)), (300 - n) * 8); all = Math.imul(all, 31) + d[0] | 0; }
console.log(all);
